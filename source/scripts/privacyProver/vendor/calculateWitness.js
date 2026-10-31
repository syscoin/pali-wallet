/* eslint-disable @typescript-eslint/no-var-requires -- The packaged prover uses CommonJS for both webpack and its standalone qualification harness. */
/*
    Copyright 2018 0kims association.

    This file is part of snarkjs.

    snarkjs is a free software: you can redistribute it and/or
    modify it under the terms of the GNU General Public License as published by the
    Free Software Foundation, either version 3 of the License, or (at your option)
    any later version.

    snarkjs is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
    more details.

    You should have received a copy of the GNU General Public License along with
    snarkjs. If not, see <https://www.gnu.org/licenses/>.
*/

// Local adaptation: generator templates and explicit depth-first frames avoid
// recursive component execution. See LICENSES.md and the pinned generator.
const bigInt = require('./bigint');

module.exports = calculateWitness;

function calculateWitness(circuit, inputSignals, options) {
  options = options || {};
  if (!options.logFunction) options.logFunction = console.log;
  const ctx = new RTCtx(circuit, options);

  function iterateSelector(values, sels, cb) {
    if (!Array.isArray(values)) {
      return cb(sels, values);
    }
    for (let i = 0; i < values.length; i++) {
      sels.push(i);
      iterateSelector(values[i], sels, cb);
      sels.pop(i);
    }
  }

  ctx.setSignal('one', [], bigInt(1));

  for (let c in ctx.notInitSignals) {
    if (ctx.notInitSignals[c] == 0) ctx.triggerComponent(c);
  }

  for (let s in inputSignals) {
    ctx.currentComponent = 'main';
    iterateSelector(inputSignals[s], [], function (selector, value) {
      if (typeof value === 'undefined')
        throw new Error('Signal not defined:' + s);
      ctx.setSignal(s, selector, bigInt(value));
    });
  }

  for (let i = 0; i < circuit.nInputs; i++) {
    const idx = circuit.inputIdx(i);
    if (typeof ctx.witness[idx] === 'undefined') {
      throw new Error('Input Signal not assigned: ' + circuit.signalNames(idx));
    }
  }

  for (let i = 0; i < ctx.witness.length; i++) {
    if (typeof ctx.witness[i] === 'undefined') {
      throw new Error('Signal not assigned: ' + circuit.signalNames(i));
    }
    if (options.logOutput)
      options.logFunction(
        circuit.signalNames(i) + ' --> ' + ctx.witness[i].toString()
      );
  }
  return ctx.witness.slice(0, circuit.nVars);
  //    return ctx.witness;
}

class RTCtx {
  constructor(circuit, options) {
    this.options = options;
    this.scopes = [];
    this.circuit = circuit;
    this.witness = new Array(circuit.nSignals);
    this.notInitSignals = {};
    this.componentFrames = [];
    this.drainingComponents = false;
    for (let c in this.circuit.components) {
      this.notInitSignals[c] = this.circuit.components[c].inputSignals;
    }
  }

  _sels2str(sels) {
    let res = '';
    for (let i = 0; i < sels.length; i++) {
      res += `[${sels[i]}]`;
    }
    return res;
  }

  setPin(componentName, componentSels, signalName, signalSels, value) {
    let fullName =
      componentName == 'one'
        ? 'one'
        : this.currentComponent + '.' + componentName;
    fullName +=
      this._sels2str(componentSels) +
      '.' +
      signalName +
      this._sels2str(signalSels);
    this.setSignalFullName(fullName, value);
  }

  setSignal(name, sels, value) {
    let fullName = this.currentComponent
      ? this.currentComponent + '.' + name
      : name;
    fullName += this._sels2str(sels);
    this.setSignalFullName(fullName, value);
  }

  triggerComponent(c) {
    this.componentFrames.push({ candidate: c });
    this.drainComponents();
  }

  drainComponents() {
    if (this.drainingComponents) return;
    this.drainingComponents = true;
    const initialComponent = this.currentComponent;
    const initialScopes = this.scopes;
    try {
      while (this.componentFrames.length) {
        const frame = this.componentFrames[this.componentFrames.length - 1];
        if (!frame.iterator) {
          this.componentFrames.pop();
          const c = frame.candidate;
          // Check when execution begins: an earlier depth-first child
          // may already have consumed a duplicate trigger candidate.
          if (this.notInitSignals[c] != 0) continue;
          this.notInitSignals[c]--;
          const component = this.circuit.components[c];
          if (this.options.logTrigger)
            this.options.logFunction('Component Treiggered: ' + component.name);
          const oldComponent = this.currentComponent;
          const oldScopes = this.scopes;
          this.currentComponent = component.name;
          const newScope = {};
          for (let p in component.params) newScope[p] = component.params[p];
          this.scopes = [oldScopes[0], newScope];
          this.componentFrames.push({
            component,
            oldComponent,
            oldScopes,
            iterator: this.circuit.templates[component.template](this),
          });
        } else if (frame.iterator.next().done) {
          if (this.componentFrames.pop() !== frame)
            throw new Error('Unexpected witness frame');
          this.scopes = frame.oldScopes;
          this.currentComponent = frame.oldComponent;
          if (this.options.logTrigger)
            this.options.logFunction(
              'End Component Treiggered: ' + frame.component.name
            );
        }
      }
    } finally {
      this.componentFrames.length = 0;
      this.scopes = initialScopes;
      this.currentComponent = initialComponent;
      this.drainingComponents = false;
    }
  }

  callFunction(functionName, params) {
    const newScope = {};
    for (
      let p = 0;
      p < this.circuit.functions[functionName].params.length;
      p++
    ) {
      const paramName = this.circuit.functions[functionName].params[p];
      newScope[paramName] = params[p];
    }

    const oldScope = this.scopes;
    this.scopes = [this.scopes[0], newScope];

    // TODO set params.

    const res = this.circuit.functions[functionName].func(this);
    this.scopes = oldScope;

    return res;
  }

  setSignalFullName(fullName, value) {
    if (this.options.logSet)
      this.options.logFunction('set ' + fullName + ' <-- ' + value.toString());
    const sId = this.circuit.getSignalIdx(fullName);
    let firstInit = false;
    if (typeof this.witness[sId] === 'undefined') {
      firstInit = true;
    }
    this.witness[sId] = bigInt(value);
    const callComponents = [];
    for (
      let i = 0;
      i < this.circuit.signals[sId].triggerComponents.length;
      i++
    ) {
      let idCmp = this.circuit.signals[sId].triggerComponents[i];
      if (firstInit) this.notInitSignals[idCmp]--;
      callComponents.push(idCmp);
    }
    // Stack candidates in reverse so the original listed order drains
    // depth-first before the suspended template resumes after this write.
    for (let i = callComponents.length - 1; i >= 0; i--) {
      this.componentFrames.push({ candidate: callComponents[i] });
    }
    this.drainComponents();
    return this.witness[sId];
  }

  setVar(name, sels, value) {
    function setVarArray(a, sels2, value) {
      if (sels2.length == 1) {
        a[sels2[0]] = value;
      } else {
        if (typeof a[sels2[0]] === 'undefined') a[sels2[0]] = [];
        setVarArray(a[sels2[0]], sels2.slice(1), value);
      }
    }
    const scope = this.scopes[this.scopes.length - 1];
    if (sels.length == 0) {
      scope[name] = value;
    } else {
      if (typeof scope[name] === 'undefined') scope[name] = [];
      setVarArray(scope[name], sels, value);
    }
    return value;
  }

  getVar(name, sels) {
    function select(a, sels2) {
      return sels2.length == 0 ? a : select(a[sels2[0]], sels2.slice(1));
    }
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (typeof this.scopes[i][name] !== 'undefined')
        return select(this.scopes[i][name], sels);
    }
    throw new Error('Variable not defined: ' + name);
  }

  getSignal(name, sels) {
    let fullName = name == 'one' ? 'one' : this.currentComponent + '.' + name;
    fullName += this._sels2str(sels);
    return this.getSignalFullName(fullName);
  }

  getPin(componentName, componentSels, signalName, signalSels) {
    let fullName =
      componentName == 'one'
        ? 'one'
        : this.currentComponent + '.' + componentName;
    fullName +=
      this._sels2str(componentSels) +
      '.' +
      signalName +
      this._sels2str(signalSels);
    return this.getSignalFullName(fullName);
  }

  getSignalFullName(fullName) {
    const sId = this.circuit.getSignalIdx(fullName);
    if (typeof this.witness[sId] === 'undefined') {
      throw new Error('Signal not initialized: ' + fullName);
    }
    if (this.options.logGet)
      this.options.logFunction(
        'get --->' + fullName + ' = ' + this.witness[sId].toString()
      );
    return this.witness[sId];
  }

  assert(a, b, errStr) {
    const ba = bigInt(a);
    const bb = bigInt(b);
    if (!ba.equals(bb)) {
      throw new Error(
        "Constraint doesn't match " +
          this.currentComponent +
          ': ' +
          errStr +
          ' -> ' +
          ba.toString() +
          ' != ' +
          bb.toString()
      );
    }
  }
}
