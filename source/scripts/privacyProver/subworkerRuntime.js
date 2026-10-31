/*
    Copyright 2019 0KIMS association.

    This file is part of websnark (Web Assembly zkSnark Prover).

    websnark is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    websnark is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with websnark. If not, see <https://www.gnu.org/licenses/>.
*/

module.exports = function installThread(self) {
  let instance;
  let memory;
  let i32;

  async function init(data) {
    const code = new Uint8Array(data.code);
    const wasmModule = await WebAssembly.compile(code);
    memory = new WebAssembly.Memory({ initial: data.init });
    i32 = new Uint32Array(memory.buffer);

    instance = await WebAssembly.instantiate(wasmModule, {
      env: {
        memory: memory,
      },
    });
  }

  function alloc(length) {
    while (i32[0] & 3) i32[0]++; // Return always aligned pointers
    const res = i32[0];
    i32[0] += length;
    while (i32[0] > memory.buffer.byteLength) {
      memory.grow(100);
    }
    i32 = new Uint32Array(memory.buffer);
    return res;
  }

  function putBin(b) {
    const p = alloc(b.byteLength);
    const s32 = new Uint32Array(b);
    i32.set(s32, p / 4);
    return p;
  }

  function getBin(p, l) {
    return memory.buffer.slice(p, p + l);
  }

  self.onmessage = function (e) {
    let data;
    if (e.data) {
      data = e.data;
    } else {
      data = e;
    }

    if (data.command == 'INIT') {
      init(data).then(function () {
        self.postMessage(data.result);
      });
    } else if (data.command == 'G1_MULTIEXP') {
      const oldAlloc = i32[0];
      const pScalars = putBin(data.scalars);
      const pPoints = putBin(data.points);
      const pRes = alloc(96);
      instance.exports.g1_zero(pRes);
      instance.exports.g1_multiexp2(pScalars, pPoints, data.n, 7, pRes);

      data.result = getBin(pRes, 96);
      i32[0] = oldAlloc;
      self.postMessage(data.result, [data.result]);
    } else if (data.command == 'G2_MULTIEXP') {
      const oldAlloc = i32[0];
      const pScalars = putBin(data.scalars);
      const pPoints = putBin(data.points);
      const pRes = alloc(192);
      instance.exports.g2_zero(pRes);
      instance.exports.g2_multiexp(pScalars, pPoints, data.n, 7, pRes);

      data.result = getBin(pRes, 192);
      i32[0] = oldAlloc;
      self.postMessage(data.result, [data.result]);
    } else if (data.command == 'CALC_H') {
      const oldAlloc = i32[0];
      const pSignals = putBin(data.signals);
      const pPolsA = putBin(data.polsA);
      const pPolsB = putBin(data.polsB);
      const nSignals = data.nSignals;
      const domainSize = data.domainSize;
      const pSignalsM = alloc(nSignals * 32);
      const pPolA = alloc(domainSize * 32);
      const pPolB = alloc(domainSize * 32);
      const pPolA2 = alloc(domainSize * 32 * 2);
      const pPolB2 = alloc(domainSize * 32 * 2);

      instance.exports.fft_toMontgomeryN(pSignals, pSignalsM, nSignals);

      instance.exports.pol_zero(pPolA, domainSize);
      instance.exports.pol_zero(pPolB, domainSize);

      instance.exports.pol_constructLC(pPolsA, pSignalsM, nSignals, pPolA);
      instance.exports.pol_constructLC(pPolsB, pSignalsM, nSignals, pPolB);

      instance.exports.fft_copyNInterleaved(pPolA, pPolA2, domainSize);
      instance.exports.fft_copyNInterleaved(pPolB, pPolB2, domainSize);

      instance.exports.fft_ifft(pPolA, domainSize, 0);
      instance.exports.fft_ifft(pPolB, domainSize, 0);
      instance.exports.fft_fft(pPolA, domainSize, 1);
      instance.exports.fft_fft(pPolB, domainSize, 1);

      instance.exports.fft_copyNInterleaved(pPolA, pPolA2 + 32, domainSize);
      instance.exports.fft_copyNInterleaved(pPolB, pPolB2 + 32, domainSize);

      instance.exports.fft_mulN(pPolA2, pPolB2, domainSize * 2, pPolA2);

      instance.exports.fft_ifft(pPolA2, domainSize * 2, 0);

      instance.exports.fft_fromMontgomeryN(
        pPolA2 + domainSize * 32,
        pPolA2 + domainSize * 32,
        domainSize
      );

      data.result = getBin(pPolA2 + domainSize * 32, domainSize * 32);
      i32[0] = oldAlloc;
      self.postMessage(data.result, [data.result]);
    } else if (data.command == 'TERMINATE') {
      self.close();
    }
  };
};
