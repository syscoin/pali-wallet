import { execFileSync } from 'child_process';
import { join } from 'path';

import fixture from './prover.fixture.json';

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  suspendSignalWrites,
} = require('../../../scripts/privacy-prover-adaptations.cjs');
const calculateWitness = require('../../scripts/privacyProver/vendor/calculateWitness.js');
/* eslint-enable @typescript-eslint/no-var-requires */

function circuitForChain(depth: number) {
  const names: Record<string, number> = { one: 0, 'main.input': 1 };
  const signals = Array.from({ length: depth + 2 }, () => ({
    triggerComponents: [] as number[],
  }));
  const components = Array.from({ length: depth }, (_, index) => {
    names[`c${index}.in`] = index + 1;
    names[`c${index}.out`] = index + 2;
    signals[index + 1].triggerComponents = [index, index];
    return {
      name: `c${index}`,
      template: 'chain',
      inputSignals: 2,
      params: { serial: BigInt(index) },
    };
  });
  return {
    nInputs: 1,
    nVars: depth + 2,
    nSignals: depth + 2,
    components,
    signals,
    functions: {},
    templates: {
      *chain(ctx: any) {
        const serial = Number(ctx.getVar('serial', []));
        ctx.setVar('saved', [], BigInt(serial));
        yield ctx.setSignal('out', [], ctx.getSignal('in', []) + BigInt(1));
        if (ctx.currentComponent !== `c${serial}`)
          throw new Error('component scope was not restored');
        if (ctx.getVar('saved', []) !== BigInt(serial))
          throw new Error('variable scope was not restored');
        ctx.assert(ctx.getSignal('out', []), BigInt(serial + 1), 'chain value');
      },
    },
    getSignalIdx: (name: string) => names[name],
    inputIdx: () => 1,
    signalNames: String,
  };
}

test('iterative component stack completes a deep chain and restores every suspended scope', () => {
  const depth = 5000;
  const trace: string[] = [];
  const witness = calculateWitness(
    circuitForChain(depth),
    { input: '0' },
    {
      logTrigger: true,
      logFunction: (message: string) => trace.push(message),
    }
  );
  expect(witness.length).toBe(depth + 2);
  expect(witness[depth + 1]).toBe(BigInt(depth));
  expect(trace).toHaveLength(depth * 2);
  expect(trace[0]).toBe('Component Treiggered: c0');
  expect(trace[depth - 1]).toBe(`Component Treiggered: c${depth - 1}`);
  expect(trace[depth]).toBe(`End Component Treiggered: c${depth - 1}`);
  expect(trace[trace.length - 1]).toBe('End Component Treiggered: c0');
});

test('candidate readiness is rechecked after earlier children execute depth-first', () => {
  const trace: string[] = [];
  const names: Record<string, number> = {
    one: 0,
    'main.input': 1,
    'a.in': 1,
    'a.out': 2,
    'b.first': 1,
    'b.second': 2,
    'b.out': 3,
  };
  const circuit = {
    nInputs: 1,
    nVars: 4,
    nSignals: 4,
    components: [
      { name: 'a', template: 'a', inputSignals: 1, params: {} },
      { name: 'b', template: 'b', inputSignals: 2, params: {} },
    ],
    signals: [
      { triggerComponents: [] },
      { triggerComponents: [0, 1] },
      { triggerComponents: [1] },
      { triggerComponents: [] },
    ],
    functions: {},
    templates: {
      *a(ctx: any) {
        trace.push('a start');
        yield ctx.setSignal('out', [], ctx.getSignal('in', []) + BigInt(1));
        trace.push('a end');
      },
      *b(ctx: any) {
        trace.push('b start');
        yield ctx.setSignal(
          'out',
          [],
          ctx.getSignal('first', []) + ctx.getSignal('second', [])
        );
        trace.push('b end');
      },
    },
    getSignalIdx: (name: string) => names[name],
    inputIdx: () => 1,
    signalNames: String,
  };
  expect(calculateWitness(circuit, { input: '2' }, {}).map(String)).toEqual([
    '1',
    '2',
    '3',
    '5',
  ]);
  expect(trace).toEqual(['a start', 'b start', 'b end', 'a end']);
});

test('build-time transformation suspends only standalone template signal writes', () => {
  expect(
    suspendSignalWrites(
      'function(ctx) { ctx.setPin("a", [], "b", [], "1"); ctx.setSignal("out", [], "2"); }'
    )
  ).toBe(
    'function*(ctx) { yield ctx.setPin("a", [], "b", [], "1"); yield ctx.setSignal("out", [], "2"); }'
  );
  expect(() =>
    suspendSignalWrites('function(ctx) { return ctx.setSignal("x", [], "1"); }')
  ).toThrow('standalone');
  expect(() =>
    suspendSignalWrites(
      'function(ctx) { ctx.setPin("a", [], "b", [], "1"); }',
      false
    )
  ).toThrow('standalone');
  expect(() =>
    suspendSignalWrites('function(ctx) { function nested() {} }')
  ).toThrow('Nested');
});

test('canonical full witness and rejected paths work with a bounded JavaScript stack', () => {
  const stdout = execFileSync(
    process.execPath,
    [
      '--stack_size=128',
      join(__dirname, '../../scripts/privacyProver/testing/witnessCheck.cjs'),
    ],
    { encoding: 'utf8', timeout: 20000 }
  );
  expect(JSON.parse(stdout)).toEqual({
    values: 28300,
    sha256: fixture.witnessSha256,
    invalidPathsRejected: 2,
  });
});
