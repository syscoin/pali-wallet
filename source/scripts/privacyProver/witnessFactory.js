/* eslint-disable @typescript-eslint/no-var-requires -- The packaged prover uses CommonJS for both webpack and its standalone qualification harness. */
/* Generated at build time from Classic circuit; GPL-3.0-or-later. See LICENSES.md. */
const bigInt = require('./vendor/bigint.js');
const calculateWitness = require('./vendor/calculateWitness.js');
const { unstringifyBigInts } = require('./vendor/stringifybigint.js');
const __P__ = bigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);
const __MASK__ = bigInt(
  '28948022309329048855892746252171976963317496166410141009864396001978282409983'
);
const templates = {
  BinSum: function* (ctx) {
    ctx.setVar(
      'nout',
      [],
      ctx.callFunction('nbits', [
        bigInt(
          bigInt(bigInt('2').modPow(bigInt(ctx.getVar('n', [])), __P__))
            .add(__P__)
            .sub(bigInt('1'))
            .mod(__P__)
        )
          .mul(bigInt(ctx.getVar('ops', [])))
          .mod(__P__),
      ])
    );
    ctx.setVar('lin', [], '0');
    ctx.setVar('lout', [], '0');
    for (
      ctx.setVar('k', [], '0');
      bigInt(
        bigInt(ctx.getVar('k', [])).lt(bigInt(ctx.getVar('n', []))) ? 1 : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'k',
          [],
          bigInt(ctx.getVar('k', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        for (
          ctx.setVar('j', [], '0');
          bigInt(
            bigInt(ctx.getVar('j', [])).lt(bigInt(ctx.getVar('ops', [])))
              ? 1
              : 0
          ).neq(bigInt(0));
          ctx
            .setVar(
              'j',
              [],
              bigInt(ctx.getVar('j', [])).add(bigInt('1')).mod(__P__)
            )
            .add(__P__)
            .sub(bigInt(1))
            .mod(__P__)
        ) {
          {
            ctx.setVar(
              'lin',
              [],
              bigInt(ctx.getVar('lin', []))
                .add(
                  bigInt(
                    bigInt(
                      ctx.getSignal('in', [
                        ctx.getVar('j', []),
                        ctx.getVar('k', []),
                      ])
                    )
                      .mul(
                        bigInt(
                          bigInt('2').modPow(bigInt(ctx.getVar('k', [])), __P__)
                        )
                      )
                      .mod(__P__)
                  )
                )
                .mod(__P__)
            );
          }
        }
      }
    }
    for (
      ctx.setVar('k', [], '0');
      bigInt(
        bigInt(ctx.getVar('k', [])).lt(bigInt(ctx.getVar('nout', []))) ? 1 : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'k',
          [],
          bigInt(ctx.getVar('k', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setSignal(
          'out',
          [ctx.getVar('k', [])],
          bigInt(
            bigInt(ctx.getVar('k', [])).greater(bigInt(256))
              ? 0
              : bigInt(ctx.getVar('lin', []))
                  .shr(bigInt(ctx.getVar('k', [])))
                  .and(__MASK__)
          )
            .and(bigInt('1'))
            .and(__MASK__)
        );
        ctx.assert(
          bigInt(ctx.getSignal('out', [ctx.getVar('k', [])]))
            .mul(
              bigInt(
                bigInt(ctx.getSignal('out', [ctx.getVar('k', [])]))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__)
              )
            )
            .mod(__P__),
          '0',
          'undefined:87:8'
        );
        ctx.setVar(
          'lout',
          [],
          bigInt(ctx.getVar('lout', []))
            .add(
              bigInt(
                bigInt(ctx.getSignal('out', [ctx.getVar('k', [])]))
                  .mul(
                    bigInt(
                      bigInt('2').modPow(bigInt(ctx.getVar('k', [])), __P__)
                    )
                  )
                  .mod(__P__)
              )
            )
            .mod(__P__)
        );
      }
    }
    ctx.assert(ctx.getVar('lin', []), ctx.getVar('lout', []), 'undefined:94:4');
  },
  IsZero: function* (ctx) {
    yield ctx.setSignal(
      'inv',
      [],
      bigInt(bigInt(ctx.getSignal('in', [])).eq(bigInt('0')) ? 0 : 1).neq(
        bigInt(0)
      )
        ? bigInt('1')
            .mul(bigInt(ctx.getSignal('in', [])).inverse(__P__))
            .mod(__P__)
        : '0'
    );
    yield ctx.setSignal(
      'out',
      [],
      bigInt(
        bigInt(__P__.sub(bigInt(ctx.getSignal('in', []))).mod(__P__))
          .mul(bigInt(ctx.getSignal('inv', [])))
          .mod(__P__)
      )
        .add(bigInt('1'))
        .mod(__P__)
    );
    ctx.assert(
      bigInt(ctx.getSignal('in', []))
        .mul(bigInt(ctx.getSignal('out', [])))
        .mod(__P__),
      '0',
      'undefined:32:4'
    );
  },
  IsEqual: function* (ctx) {
    yield ctx.setPin(
      'isz',
      [],
      'in',
      [],
      bigInt(ctx.getSignal('in', ['1']))
        .add(__P__)
        .sub(bigInt(ctx.getSignal('in', ['0'])))
        .mod(__P__)
    );
    yield ctx.setSignal('out', [], ctx.getPin('isz', [], 'out', []));
  },
  ForceEqualIfEnabled: function* (ctx) {
    yield ctx.setPin(
      'isz',
      [],
      'in',
      [],
      bigInt(ctx.getSignal('in', ['1']))
        .add(__P__)
        .sub(bigInt(ctx.getSignal('in', ['0'])))
        .mod(__P__)
    );
    ctx.assert(
      bigInt(
        bigInt('1')
          .add(__P__)
          .sub(bigInt(ctx.getPin('isz', [], 'out', [])))
          .mod(__P__)
      )
        .mul(bigInt(ctx.getSignal('enabled', [])))
        .mod(__P__),
      '0',
      'undefined:55:4'
    );
  },
  LessThan: function* (ctx) {
    yield ctx.setPin(
      'n2b',
      [],
      'in',
      [],
      bigInt(
        bigInt(ctx.getSignal('in', ['0']))
          .add(
            bigInt(
              bigInt(ctx.getVar('n', [])).greater(bigInt(256))
                ? 0
                : bigInt('1')
                    .shl(bigInt(ctx.getVar('n', [])))
                    .and(__MASK__)
            )
          )
          .mod(__P__)
      )
        .add(__P__)
        .sub(bigInt(ctx.getSignal('in', ['1'])))
        .mod(__P__)
    );
    yield ctx.setSignal(
      'out',
      [],
      bigInt('1')
        .add(__P__)
        .sub(bigInt(ctx.getPin('n2b', [], 'out', [ctx.getVar('n', [])])))
        .mod(__P__)
    );
  },
  LessEqThan: function* (ctx) {
    yield ctx.setPin('lt', [], 'in', ['0'], ctx.getSignal('in', ['0']));
    yield ctx.setPin(
      'lt',
      [],
      'in',
      ['1'],
      bigInt(ctx.getSignal('in', ['1']))
        .add(bigInt('1'))
        .mod(__P__)
    );
    yield ctx.setSignal('out', [], ctx.getPin('lt', [], 'out', []));
  },
  GreaterThan: function* (ctx) {
    yield ctx.setPin('lt', [], 'in', ['0'], ctx.getSignal('in', ['1']));
    yield ctx.setPin('lt', [], 'in', ['1'], ctx.getSignal('in', ['0']));
    yield ctx.setSignal('out', [], ctx.getPin('lt', [], 'out', []));
  },
  GreaterEqThan: function* (ctx) {
    yield ctx.setPin('lt', [], 'in', ['0'], ctx.getSignal('in', ['1']));
    yield ctx.setPin(
      'lt',
      [],
      'in',
      ['1'],
      bigInt(ctx.getSignal('in', ['0']))
        .add(bigInt('1'))
        .mod(__P__)
    );
    yield ctx.setSignal('out', [], ctx.getPin('lt', [], 'out', []));
  },
  CompConstant: function* (ctx) {
    ctx.setVar('sum', [], '0');
    ctx.setVar('b', [], '340282366920938463463374607431768211455');
    ctx.setVar('a', [], '1');
    ctx.setVar('e', [], '1');
    for (
      ctx.setVar('i', [], '0');
      bigInt(bigInt(ctx.getVar('i', [])).lt(bigInt('127')) ? 1 : 0).neq(
        bigInt(0)
      );
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        ctx.setVar(
          'clsb',
          [],
          bigInt(
            bigInt(
              bigInt(ctx.getVar('i', [])).mul(bigInt('2')).mod(__P__)
            ).greater(bigInt(256))
              ? 0
              : bigInt(ctx.getVar('ct', []))
                  .shr(
                    bigInt(
                      bigInt(ctx.getVar('i', [])).mul(bigInt('2')).mod(__P__)
                    )
                  )
                  .and(__MASK__)
          )
            .and(bigInt('1'))
            .and(__MASK__)
        );
        ctx.setVar(
          'cmsb',
          [],
          bigInt(
            bigInt(
              bigInt(bigInt(ctx.getVar('i', [])).mul(bigInt('2')).mod(__P__))
                .add(bigInt('1'))
                .mod(__P__)
            ).greater(bigInt(256))
              ? 0
              : bigInt(ctx.getVar('ct', []))
                  .shr(
                    bigInt(
                      bigInt(
                        bigInt(ctx.getVar('i', [])).mul(bigInt('2')).mod(__P__)
                      )
                        .add(bigInt('1'))
                        .mod(__P__)
                    )
                  )
                  .and(__MASK__)
          )
            .and(bigInt('1'))
            .and(__MASK__)
        );
        ctx.setVar(
          'slsb',
          [],
          ctx.getSignal('in', [
            bigInt(ctx.getVar('i', [])).mul(bigInt('2')).mod(__P__),
          ])
        );
        ctx.setVar(
          'smsb',
          [],
          ctx.getSignal('in', [
            bigInt(bigInt(ctx.getVar('i', [])).mul(bigInt('2')).mod(__P__))
              .add(bigInt('1'))
              .mod(__P__),
          ])
        );
        if (
          bigInt(
            bigInt(bigInt(ctx.getVar('cmsb', [])).eq(bigInt('0')) ? 1 : 0)
              .and(
                bigInt(bigInt(ctx.getVar('clsb', [])).eq(bigInt('0')) ? 1 : 0)
              )
              .and(__MASK__)
          ).neq(bigInt(0))
        ) {
          {
            yield ctx.setSignal(
              'parts',
              [ctx.getVar('i', [])],
              bigInt(
                bigInt(
                  bigInt(
                    bigInt(__P__.sub(bigInt(ctx.getVar('b', []))).mod(__P__))
                      .mul(bigInt(ctx.getVar('smsb', [])))
                      .mod(__P__)
                  )
                    .mul(bigInt(ctx.getVar('slsb', [])))
                    .mod(__P__)
                )
                  .add(
                    bigInt(
                      bigInt(ctx.getVar('b', []))
                        .mul(bigInt(ctx.getVar('smsb', [])))
                        .mod(__P__)
                    )
                  )
                  .mod(__P__)
              )
                .add(
                  bigInt(
                    bigInt(ctx.getVar('b', []))
                      .mul(bigInt(ctx.getVar('slsb', [])))
                      .mod(__P__)
                  )
                )
                .mod(__P__)
            );
          }
        } else {
          if (
            bigInt(
              bigInt(bigInt(ctx.getVar('cmsb', [])).eq(bigInt('0')) ? 1 : 0)
                .and(
                  bigInt(bigInt(ctx.getVar('clsb', [])).eq(bigInt('1')) ? 1 : 0)
                )
                .and(__MASK__)
            ).neq(bigInt(0))
          ) {
            {
              yield ctx.setSignal(
                'parts',
                [ctx.getVar('i', [])],
                bigInt(
                  bigInt(
                    bigInt(
                      bigInt(
                        bigInt(
                          bigInt(ctx.getVar('a', []))
                            .mul(bigInt(ctx.getVar('smsb', [])))
                            .mod(__P__)
                        )
                          .mul(bigInt(ctx.getVar('slsb', [])))
                          .mod(__P__)
                      )
                        .add(__P__)
                        .sub(
                          bigInt(
                            bigInt(ctx.getVar('a', []))
                              .mul(bigInt(ctx.getVar('slsb', [])))
                              .mod(__P__)
                          )
                        )
                        .mod(__P__)
                    )
                      .add(
                        bigInt(
                          bigInt(ctx.getVar('b', []))
                            .mul(bigInt(ctx.getVar('smsb', [])))
                            .mod(__P__)
                        )
                      )
                      .mod(__P__)
                  )
                    .add(__P__)
                    .sub(
                      bigInt(
                        bigInt(ctx.getVar('a', []))
                          .mul(bigInt(ctx.getVar('smsb', [])))
                          .mod(__P__)
                      )
                    )
                    .mod(__P__)
                )
                  .add(bigInt(ctx.getVar('a', [])))
                  .mod(__P__)
              );
            }
          } else {
            if (
              bigInt(
                bigInt(bigInt(ctx.getVar('cmsb', [])).eq(bigInt('1')) ? 1 : 0)
                  .and(
                    bigInt(
                      bigInt(ctx.getVar('clsb', [])).eq(bigInt('0')) ? 1 : 0
                    )
                  )
                  .and(__MASK__)
              ).neq(bigInt(0))
            ) {
              {
                yield ctx.setSignal(
                  'parts',
                  [ctx.getVar('i', [])],
                  bigInt(
                    bigInt(
                      bigInt(
                        bigInt(ctx.getVar('b', []))
                          .mul(bigInt(ctx.getVar('smsb', [])))
                          .mod(__P__)
                      )
                        .mul(bigInt(ctx.getVar('slsb', [])))
                        .mod(__P__)
                    )
                      .add(__P__)
                      .sub(
                        bigInt(
                          bigInt(ctx.getVar('a', []))
                            .mul(bigInt(ctx.getVar('smsb', [])))
                            .mod(__P__)
                        )
                      )
                      .mod(__P__)
                  )
                    .add(bigInt(ctx.getVar('a', [])))
                    .mod(__P__)
                );
              }
            } else {
              {
                yield ctx.setSignal(
                  'parts',
                  [ctx.getVar('i', [])],
                  bigInt(
                    bigInt(
                      bigInt(__P__.sub(bigInt(ctx.getVar('a', []))).mod(__P__))
                        .mul(bigInt(ctx.getVar('smsb', [])))
                        .mod(__P__)
                    )
                      .mul(bigInt(ctx.getVar('slsb', [])))
                      .mod(__P__)
                  )
                    .add(bigInt(ctx.getVar('a', [])))
                    .mod(__P__)
                );
              }
            }
          }
        }
        ctx.setVar(
          'sum',
          [],
          bigInt(ctx.getVar('sum', []))
            .add(bigInt(ctx.getSignal('parts', [ctx.getVar('i', [])])))
            .mod(__P__)
        );
        ctx.setVar(
          'b',
          [],
          bigInt(ctx.getVar('b', []))
            .add(__P__)
            .sub(bigInt(ctx.getVar('e', [])))
            .mod(__P__)
        );
        ctx.setVar(
          'a',
          [],
          bigInt(ctx.getVar('a', []))
            .add(bigInt(ctx.getVar('e', [])))
            .mod(__P__)
        );
        ctx.setVar(
          'e',
          [],
          bigInt(ctx.getVar('e', [])).mul(bigInt('2')).mod(__P__)
        );
      }
    }
    yield ctx.setSignal('sout', [], ctx.getVar('sum', []));
    yield ctx.setPin('num2bits', [], 'in', [], ctx.getSignal('sout', []));
    yield ctx.setSignal('out', [], ctx.getPin('num2bits', [], 'out', ['127']));
  },
  AliasCheck: function* (ctx) {
    for (
      ctx.setVar('i', [], '0');
      bigInt(bigInt(ctx.getVar('i', [])).lt(bigInt('254')) ? 1 : 0).neq(
        bigInt(0)
      );
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      yield ctx.setPin(
        'compConstant',
        [],
        'in',
        [ctx.getVar('i', [])],
        ctx.getSignal('in', [ctx.getVar('i', [])])
      );
    }
    ctx.assert(
      ctx.getPin('compConstant', [], 'out', []),
      '0',
      'undefined:30:4'
    );
  },
  AliasCheckBabyJub: function* (ctx) {
    for (
      ctx.setVar('i', [], '0');
      bigInt(bigInt(ctx.getVar('i', [])).lt(bigInt('251')) ? 1 : 0).neq(
        bigInt(0)
      );
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      yield ctx.setPin(
        'compConstant',
        [],
        'in',
        [ctx.getVar('i', [])],
        ctx.getSignal('in', [ctx.getVar('i', [])])
      );
    }
    for (
      ctx.setVar('i', [], '0');
      bigInt(bigInt(ctx.getVar('i', [])).lt(bigInt('3')) ? 1 : 0).neq(
        bigInt(0)
      );
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      yield ctx.setPin(
        'compConstant',
        [],
        'in',
        [
          bigInt('251')
            .add(bigInt(ctx.getVar('i', [])))
            .mod(__P__),
        ],
        '0'
      );
    }
    ctx.assert(
      bigInt(ctx.getPin('compConstant', [], 'out', []))
        .mul(bigInt(ctx.getSignal('enabled', [])))
        .mod(__P__),
      '0',
      'undefined:42:4'
    );
  },
  Num2Bits: function* (ctx) {
    ctx.setVar('lc1', [], '0');
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('n', []))) ? 1 : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setSignal(
          'out',
          [ctx.getVar('i', [])],
          bigInt(
            bigInt(ctx.getVar('i', [])).greater(bigInt(256))
              ? 0
              : bigInt(ctx.getSignal('in', []))
                  .shr(bigInt(ctx.getVar('i', [])))
                  .and(__MASK__)
          )
            .and(bigInt('1'))
            .and(__MASK__)
        );
        ctx.assert(
          bigInt(ctx.getSignal('out', [ctx.getVar('i', [])]))
            .mul(
              bigInt(
                bigInt(ctx.getSignal('out', [ctx.getVar('i', [])]))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__)
              )
            )
            .mod(__P__),
          '0',
          '/Users/rstorm/repos/stormdapps/tornado-core/node_modules/circomlib/circuits/bitify.circom:32:8'
        );
        ctx.setVar(
          'lc1',
          [],
          bigInt(ctx.getVar('lc1', []))
            .add(
              bigInt(
                bigInt(ctx.getSignal('out', [ctx.getVar('i', [])]))
                  .mul(
                    bigInt(
                      bigInt('2').modPow(bigInt(ctx.getVar('i', [])), __P__)
                    )
                  )
                  .mod(__P__)
              )
            )
            .mod(__P__)
        );
      }
    }
    ctx.assert(
      ctx.getVar('lc1', []),
      ctx.getSignal('in', []),
      '/Users/rstorm/repos/stormdapps/tornado-core/node_modules/circomlib/circuits/bitify.circom:36:4'
    );
  },
  Num2Bits_strict: function* (ctx) {
    yield ctx.setPin('n2b', [], 'in', [], ctx.getSignal('in', []));
    for (
      ctx.setVar('i', [], '0');
      bigInt(bigInt(ctx.getVar('i', [])).lt(bigInt('254')) ? 1 : 0).neq(
        bigInt(0)
      );
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setSignal(
          'out',
          [ctx.getVar('i', [])],
          ctx.getPin('n2b', [], 'out', [ctx.getVar('i', [])])
        );
        yield ctx.setPin(
          'aliasCheck',
          [],
          'in',
          [ctx.getVar('i', [])],
          ctx.getPin('n2b', [], 'out', [ctx.getVar('i', [])])
        );
      }
    }
  },
  Bits2Num: function* (ctx) {
    ctx.setVar('lc1', [], '0');
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('n', []))) ? 1 : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        ctx.setVar(
          'lc1',
          [],
          bigInt(ctx.getVar('lc1', []))
            .add(
              bigInt(
                bigInt(ctx.getSignal('in', [ctx.getVar('i', [])]))
                  .mul(
                    bigInt(
                      bigInt('2').modPow(bigInt(ctx.getVar('i', [])), __P__)
                    )
                  )
                  .mod(__P__)
              )
            )
            .mod(__P__)
        );
      }
    }
    yield ctx.setSignal('out', [], ctx.getVar('lc1', []));
  },
  Bits2Num_strict: function* (ctx) {
    for (
      ctx.setVar('i', [], '0');
      bigInt(bigInt(ctx.getVar('i', [])).lt(bigInt('254')) ? 1 : 0).neq(
        bigInt(0)
      );
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setPin(
          'b2n',
          [],
          'in',
          [ctx.getVar('i', [])],
          ctx.getSignal('in', [ctx.getVar('i', [])])
        );
        yield ctx.setPin(
          'aliasCheck',
          [],
          'in',
          [ctx.getVar('i', [])],
          ctx.getSignal('in', [ctx.getVar('i', [])])
        );
      }
    }
    yield ctx.setSignal('out', [], ctx.getPin('b2n', [], 'out', []));
  },
  Num2BitsNeg: function* (ctx) {
    ctx.setVar('lc1', [], '0');
    ctx.setVar(
      'neg',
      [],
      bigInt(bigInt(ctx.getVar('n', [])).eq(bigInt('0')) ? 1 : 0).neq(bigInt(0))
        ? '0'
        : bigInt(bigInt('2').modPow(bigInt(ctx.getVar('n', [])), __P__))
            .add(__P__)
            .sub(bigInt(ctx.getSignal('in', [])))
            .mod(__P__)
    );
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('n', []))) ? 1 : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setSignal(
          'out',
          [ctx.getVar('i', [])],
          bigInt(
            bigInt(ctx.getVar('i', [])).greater(bigInt(256))
              ? 0
              : bigInt(ctx.getVar('neg', []))
                  .shr(bigInt(ctx.getVar('i', [])))
                  .and(__MASK__)
          )
            .and(bigInt('1'))
            .and(__MASK__)
        );
        ctx.assert(
          bigInt(ctx.getSignal('out', [ctx.getVar('i', [])]))
            .mul(
              bigInt(
                bigInt(ctx.getSignal('out', [ctx.getVar('i', [])]))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__)
              )
            )
            .mod(__P__),
          '0',
          'undefined:94:8'
        );
        ctx.setVar(
          'lc1',
          [],
          bigInt(ctx.getVar('lc1', []))
            .add(
              bigInt(
                bigInt(ctx.getSignal('out', [ctx.getVar('i', [])]))
                  .mul(
                    bigInt(
                      bigInt('2').modPow(bigInt(ctx.getVar('i', [])), __P__)
                    )
                  )
                  .mod(__P__)
              )
            )
            .mod(__P__)
        );
      }
    }
    yield ctx.setPin('isZero', [], 'in', [], ctx.getSignal('in', []));
    ctx.assert(
      bigInt(ctx.getVar('lc1', []))
        .add(
          bigInt(
            bigInt(ctx.getPin('isZero', [], 'out', []))
              .mul(
                bigInt(bigInt('2').modPow(bigInt(ctx.getVar('n', [])), __P__))
              )
              .mod(__P__)
          )
        )
        .mod(__P__),
      bigInt(bigInt('2').modPow(bigInt(ctx.getVar('n', [])), __P__))
        .add(__P__)
        .sub(bigInt(ctx.getSignal('in', [])))
        .mod(__P__),
      'undefined:102:4'
    );
  },
  Edwards2Montgomery: function* (ctx) {
    yield ctx.setSignal(
      'out',
      ['0'],
      bigInt(
        bigInt('1')
          .add(bigInt(ctx.getSignal('in', ['1'])))
          .mod(__P__)
      )
        .mul(
          bigInt(
            bigInt('1')
              .add(__P__)
              .sub(bigInt(ctx.getSignal('in', ['1'])))
              .mod(__P__)
          ).inverse(__P__)
        )
        .mod(__P__)
    );
    yield ctx.setSignal(
      'out',
      ['1'],
      bigInt(ctx.getSignal('out', ['0']))
        .mul(bigInt(ctx.getSignal('in', ['0'])).inverse(__P__))
        .mod(__P__)
    );
    ctx.assert(
      bigInt(ctx.getSignal('out', ['0']))
        .mul(
          bigInt(
            bigInt('1')
              .add(__P__)
              .sub(bigInt(ctx.getSignal('in', ['1'])))
              .mod(__P__)
          )
        )
        .mod(__P__),
      bigInt('1')
        .add(bigInt(ctx.getSignal('in', ['1'])))
        .mod(__P__),
      '/Users/rstorm/repos/stormdapps/tornado-core/node_modules/circomlib/circuits/montgomery.circom:37:4'
    );
    ctx.assert(
      bigInt(ctx.getSignal('out', ['1']))
        .mul(bigInt(ctx.getSignal('in', ['0'])))
        .mod(__P__),
      ctx.getSignal('out', ['0']),
      '/Users/rstorm/repos/stormdapps/tornado-core/node_modules/circomlib/circuits/montgomery.circom:38:4'
    );
  },
  Montgomery2Edwards: function* (ctx) {
    yield ctx.setSignal(
      'out',
      ['0'],
      bigInt(ctx.getSignal('in', ['0']))
        .mul(bigInt(ctx.getSignal('in', ['1'])).inverse(__P__))
        .mod(__P__)
    );
    yield ctx.setSignal(
      'out',
      ['1'],
      bigInt(
        bigInt(ctx.getSignal('in', ['0']))
          .add(__P__)
          .sub(bigInt('1'))
          .mod(__P__)
      )
        .mul(
          bigInt(
            bigInt(ctx.getSignal('in', ['0']))
              .add(bigInt('1'))
              .mod(__P__)
          ).inverse(__P__)
        )
        .mod(__P__)
    );
    ctx.assert(
      bigInt(ctx.getSignal('out', ['0']))
        .mul(bigInt(ctx.getSignal('in', ['1'])))
        .mod(__P__),
      ctx.getSignal('in', ['0']),
      '/Users/rstorm/repos/stormdapps/tornado-core/node_modules/circomlib/circuits/montgomery.circom:55:4'
    );
    ctx.assert(
      bigInt(ctx.getSignal('out', ['1']))
        .mul(
          bigInt(
            bigInt(ctx.getSignal('in', ['0']))
              .add(bigInt('1'))
              .mod(__P__)
          )
        )
        .mod(__P__),
      bigInt(ctx.getSignal('in', ['0']))
        .add(__P__)
        .sub(bigInt('1'))
        .mod(__P__),
      '/Users/rstorm/repos/stormdapps/tornado-core/node_modules/circomlib/circuits/montgomery.circom:56:4'
    );
  },
  MontgomeryAdd: function* (ctx) {
    ctx.setVar('a', [], '168700');
    ctx.setVar('d', [], '168696');
    ctx.setVar(
      'A',
      [],
      bigInt(
        bigInt('2')
          .mul(
            bigInt(
              bigInt(ctx.getVar('a', []))
                .add(bigInt(ctx.getVar('d', [])))
                .mod(__P__)
            )
          )
          .mod(__P__)
      )
        .mul(
          bigInt(
            bigInt(ctx.getVar('a', []))
              .add(__P__)
              .sub(bigInt(ctx.getVar('d', [])))
              .mod(__P__)
          ).inverse(__P__)
        )
        .mod(__P__)
    );
    ctx.setVar(
      'B',
      [],
      bigInt('4')
        .mul(
          bigInt(
            bigInt(ctx.getVar('a', []))
              .add(__P__)
              .sub(bigInt(ctx.getVar('d', [])))
              .mod(__P__)
          ).inverse(__P__)
        )
        .mod(__P__)
    );
    yield ctx.setSignal(
      'lamda',
      [],
      bigInt(
        bigInt(ctx.getSignal('in2', ['1']))
          .add(__P__)
          .sub(bigInt(ctx.getSignal('in1', ['1'])))
          .mod(__P__)
      )
        .mul(
          bigInt(
            bigInt(ctx.getSignal('in2', ['0']))
              .add(__P__)
              .sub(bigInt(ctx.getSignal('in1', ['0'])))
              .mod(__P__)
          ).inverse(__P__)
        )
        .mod(__P__)
    );
    ctx.assert(
      bigInt(ctx.getSignal('lamda', []))
        .mul(
          bigInt(
            bigInt(ctx.getSignal('in2', ['0']))
              .add(__P__)
              .sub(bigInt(ctx.getSignal('in1', ['0'])))
              .mod(__P__)
          )
        )
        .mod(__P__),
      bigInt(ctx.getSignal('in2', ['1']))
        .add(__P__)
        .sub(bigInt(ctx.getSignal('in1', ['1'])))
        .mod(__P__),
      '/Users/rstorm/repos/stormdapps/tornado-core/node_modules/circomlib/circuits/montgomery.circom:103:4'
    );
    yield ctx.setSignal(
      'out',
      ['0'],
      bigInt(
        bigInt(
          bigInt(
            bigInt(
              bigInt(ctx.getVar('B', []))
                .mul(bigInt(ctx.getSignal('lamda', [])))
                .mod(__P__)
            )
              .mul(bigInt(ctx.getSignal('lamda', [])))
              .mod(__P__)
          )
            .add(__P__)
            .sub(bigInt(ctx.getVar('A', [])))
            .mod(__P__)
        )
          .add(__P__)
          .sub(bigInt(ctx.getSignal('in1', ['0'])))
          .mod(__P__)
      )
        .add(__P__)
        .sub(bigInt(ctx.getSignal('in2', ['0'])))
        .mod(__P__)
    );
    yield ctx.setSignal(
      'out',
      ['1'],
      bigInt(
        bigInt(ctx.getSignal('lamda', []))
          .mul(
            bigInt(
              bigInt(ctx.getSignal('in1', ['0']))
                .add(__P__)
                .sub(bigInt(ctx.getSignal('out', ['0'])))
                .mod(__P__)
            )
          )
          .mod(__P__)
      )
        .add(__P__)
        .sub(bigInt(ctx.getSignal('in1', ['1'])))
        .mod(__P__)
    );
  },
  MontgomeryDouble: function* (ctx) {
    ctx.setVar('a', [], '168700');
    ctx.setVar('d', [], '168696');
    ctx.setVar(
      'A',
      [],
      bigInt(
        bigInt('2')
          .mul(
            bigInt(
              bigInt(ctx.getVar('a', []))
                .add(bigInt(ctx.getVar('d', [])))
                .mod(__P__)
            )
          )
          .mod(__P__)
      )
        .mul(
          bigInt(
            bigInt(ctx.getVar('a', []))
              .add(__P__)
              .sub(bigInt(ctx.getVar('d', [])))
              .mod(__P__)
          ).inverse(__P__)
        )
        .mod(__P__)
    );
    ctx.setVar(
      'B',
      [],
      bigInt('4')
        .mul(
          bigInt(
            bigInt(ctx.getVar('a', []))
              .add(__P__)
              .sub(bigInt(ctx.getVar('d', [])))
              .mod(__P__)
          ).inverse(__P__)
        )
        .mod(__P__)
    );
    yield ctx.setSignal(
      'x1_2',
      [],
      bigInt(ctx.getSignal('in', ['0']))
        .mul(bigInt(ctx.getSignal('in', ['0'])))
        .mod(__P__)
    );
    yield ctx.setSignal(
      'lamda',
      [],
      bigInt(
        bigInt(
          bigInt(
            bigInt('3')
              .mul(bigInt(ctx.getSignal('x1_2', [])))
              .mod(__P__)
          )
            .add(
              bigInt(
                bigInt(
                  bigInt('2')
                    .mul(bigInt(ctx.getVar('A', [])))
                    .mod(__P__)
                )
                  .mul(bigInt(ctx.getSignal('in', ['0'])))
                  .mod(__P__)
              )
            )
            .mod(__P__)
        )
          .add(bigInt('1'))
          .mod(__P__)
      )
        .mul(
          bigInt(
            bigInt(
              bigInt('2')
                .mul(bigInt(ctx.getVar('B', [])))
                .mod(__P__)
            )
              .mul(bigInt(ctx.getSignal('in', ['1'])))
              .mod(__P__)
          ).inverse(__P__)
        )
        .mod(__P__)
    );
    ctx.assert(
      bigInt(ctx.getSignal('lamda', []))
        .mul(
          bigInt(
            bigInt(
              bigInt('2')
                .mul(bigInt(ctx.getVar('B', [])))
                .mod(__P__)
            )
              .mul(bigInt(ctx.getSignal('in', ['1'])))
              .mod(__P__)
          )
        )
        .mod(__P__),
      bigInt(
        bigInt(
          bigInt('3')
            .mul(bigInt(ctx.getSignal('x1_2', [])))
            .mod(__P__)
        )
          .add(
            bigInt(
              bigInt(
                bigInt('2')
                  .mul(bigInt(ctx.getVar('A', [])))
                  .mod(__P__)
              )
                .mul(bigInt(ctx.getSignal('in', ['0'])))
                .mod(__P__)
            )
          )
          .mod(__P__)
      )
        .add(bigInt('1'))
        .mod(__P__),
      '/Users/rstorm/repos/stormdapps/tornado-core/node_modules/circomlib/circuits/montgomery.circom:138:4'
    );
    yield ctx.setSignal(
      'out',
      ['0'],
      bigInt(
        bigInt(
          bigInt(
            bigInt(ctx.getVar('B', []))
              .mul(bigInt(ctx.getSignal('lamda', [])))
              .mod(__P__)
          )
            .mul(bigInt(ctx.getSignal('lamda', [])))
            .mod(__P__)
        )
          .add(__P__)
          .sub(bigInt(ctx.getVar('A', [])))
          .mod(__P__)
      )
        .add(__P__)
        .sub(
          bigInt(
            bigInt('2')
              .mul(bigInt(ctx.getSignal('in', ['0'])))
              .mod(__P__)
          )
        )
        .mod(__P__)
    );
    yield ctx.setSignal(
      'out',
      ['1'],
      bigInt(
        bigInt(ctx.getSignal('lamda', []))
          .mul(
            bigInt(
              bigInt(ctx.getSignal('in', ['0']))
                .add(__P__)
                .sub(bigInt(ctx.getSignal('out', ['0'])))
                .mod(__P__)
            )
          )
          .mod(__P__)
      )
        .add(__P__)
        .sub(bigInt(ctx.getSignal('in', ['1'])))
        .mod(__P__)
    );
  },
  MultiMux3: function* (ctx) {
    yield ctx.setSignal(
      's10',
      [],
      bigInt(ctx.getSignal('s', ['1']))
        .mul(bigInt(ctx.getSignal('s', ['0'])))
        .mod(__P__)
    );
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('n', []))) ? 1 : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setSignal(
          'a210',
          [ctx.getVar('i', [])],
          bigInt(
            bigInt(
              bigInt(
                bigInt(
                  bigInt(
                    bigInt(
                      bigInt(
                        bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '7']))
                          .add(__P__)
                          .sub(
                            bigInt(
                              ctx.getSignal('c', [ctx.getVar('i', []), '6'])
                            )
                          )
                          .mod(__P__)
                      )
                        .add(__P__)
                        .sub(
                          bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '5']))
                        )
                        .mod(__P__)
                    )
                      .add(
                        bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '4']))
                      )
                      .mod(__P__)
                  )
                    .add(__P__)
                    .sub(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '3'])))
                    .mod(__P__)
                )
                  .add(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '2'])))
                  .mod(__P__)
              )
                .add(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '1'])))
                .mod(__P__)
            )
              .add(__P__)
              .sub(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '0'])))
              .mod(__P__)
          )
            .mul(bigInt(ctx.getSignal('s10', [])))
            .mod(__P__)
        );
        yield ctx.setSignal(
          'a21',
          [ctx.getVar('i', [])],
          bigInt(
            bigInt(
              bigInt(
                bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '6']))
                  .add(__P__)
                  .sub(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '4'])))
                  .mod(__P__)
              )
                .add(__P__)
                .sub(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '2'])))
                .mod(__P__)
            )
              .add(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '0'])))
              .mod(__P__)
          )
            .mul(bigInt(ctx.getSignal('s', ['1'])))
            .mod(__P__)
        );
        yield ctx.setSignal(
          'a20',
          [ctx.getVar('i', [])],
          bigInt(
            bigInt(
              bigInt(
                bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '5']))
                  .add(__P__)
                  .sub(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '4'])))
                  .mod(__P__)
              )
                .add(__P__)
                .sub(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '1'])))
                .mod(__P__)
            )
              .add(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '0'])))
              .mod(__P__)
          )
            .mul(bigInt(ctx.getSignal('s', ['0'])))
            .mod(__P__)
        );
        yield ctx.setSignal(
          'a2',
          [ctx.getVar('i', [])],
          bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '4']))
            .add(__P__)
            .sub(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '0'])))
            .mod(__P__)
        );
        yield ctx.setSignal(
          'a10',
          [ctx.getVar('i', [])],
          bigInt(
            bigInt(
              bigInt(
                bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '3']))
                  .add(__P__)
                  .sub(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '2'])))
                  .mod(__P__)
              )
                .add(__P__)
                .sub(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '1'])))
                .mod(__P__)
            )
              .add(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '0'])))
              .mod(__P__)
          )
            .mul(bigInt(ctx.getSignal('s10', [])))
            .mod(__P__)
        );
        yield ctx.setSignal(
          'a1',
          [ctx.getVar('i', [])],
          bigInt(
            bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '2']))
              .add(__P__)
              .sub(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '0'])))
              .mod(__P__)
          )
            .mul(bigInt(ctx.getSignal('s', ['1'])))
            .mod(__P__)
        );
        yield ctx.setSignal(
          'a0',
          [ctx.getVar('i', [])],
          bigInt(
            bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '1']))
              .add(__P__)
              .sub(bigInt(ctx.getSignal('c', [ctx.getVar('i', []), '0'])))
              .mod(__P__)
          )
            .mul(bigInt(ctx.getSignal('s', ['0'])))
            .mod(__P__)
        );
        yield ctx.setSignal(
          'a',
          [ctx.getVar('i', [])],
          ctx.getSignal('c', [ctx.getVar('i', []), '0'])
        );
        yield ctx.setSignal(
          'out',
          [ctx.getVar('i', [])],
          bigInt(
            bigInt(
              bigInt(
                bigInt(
                  bigInt(ctx.getSignal('a210', [ctx.getVar('i', [])]))
                    .add(bigInt(ctx.getSignal('a21', [ctx.getVar('i', [])])))
                    .mod(__P__)
                )
                  .add(bigInt(ctx.getSignal('a20', [ctx.getVar('i', [])])))
                  .mod(__P__)
              )
                .add(bigInt(ctx.getSignal('a2', [ctx.getVar('i', [])])))
                .mod(__P__)
            )
              .mul(bigInt(ctx.getSignal('s', ['2'])))
              .mod(__P__)
          )
            .add(
              bigInt(
                bigInt(
                  bigInt(
                    bigInt(ctx.getSignal('a10', [ctx.getVar('i', [])]))
                      .add(bigInt(ctx.getSignal('a1', [ctx.getVar('i', [])])))
                      .mod(__P__)
                  )
                    .add(bigInt(ctx.getSignal('a0', [ctx.getVar('i', [])])))
                    .mod(__P__)
                )
                  .add(bigInt(ctx.getSignal('a', [ctx.getVar('i', [])])))
                  .mod(__P__)
              )
            )
            .mod(__P__)
        );
      }
    }
  },
  Mux3: function* (ctx) {
    for (
      ctx.setVar('i', [], '0');
      bigInt(bigInt(ctx.getVar('i', [])).lt(bigInt('8')) ? 1 : 0).neq(
        bigInt(0)
      );
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setPin(
          'mux',
          [],
          'c',
          ['0', ctx.getVar('i', [])],
          ctx.getSignal('c', [ctx.getVar('i', [])])
        );
      }
    }
    for (
      ctx.setVar('i', [], '0');
      bigInt(bigInt(ctx.getVar('i', [])).lt(bigInt('3')) ? 1 : 0).neq(
        bigInt(0)
      );
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setPin(
          'mux',
          [],
          's',
          [ctx.getVar('i', [])],
          ctx.getSignal('s', [ctx.getVar('i', [])])
        );
      }
    }
    yield ctx.setSignal('out', [], ctx.getPin('mux', [], 'out', ['0']));
  },
  WindowMulFix: function* (ctx) {
    yield ctx.setPin('mux', [], 's', ['0'], ctx.getSignal('in', ['0']));
    yield ctx.setPin('mux', [], 's', ['1'], ctx.getSignal('in', ['1']));
    yield ctx.setPin('mux', [], 's', ['2'], ctx.getSignal('in', ['2']));
    yield ctx.setPin('mux', [], 'c', ['0', '0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('mux', [], 'c', ['1', '0'], ctx.getSignal('base', ['1']));
    yield ctx.setPin('dbl2', [], 'in', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('dbl2', [], 'in', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '1'],
      ctx.getPin('dbl2', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '1'],
      ctx.getPin('dbl2', [], 'out', ['1'])
    );
    yield ctx.setPin('adr3', [], 'in1', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('adr3', [], 'in1', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'adr3',
      [],
      'in2',
      ['0'],
      ctx.getPin('dbl2', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'adr3',
      [],
      'in2',
      ['1'],
      ctx.getPin('dbl2', [], 'out', ['1'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '2'],
      ctx.getPin('adr3', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '2'],
      ctx.getPin('adr3', [], 'out', ['1'])
    );
    yield ctx.setPin('adr4', [], 'in1', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('adr4', [], 'in1', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'adr4',
      [],
      'in2',
      ['0'],
      ctx.getPin('adr3', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'adr4',
      [],
      'in2',
      ['1'],
      ctx.getPin('adr3', [], 'out', ['1'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '3'],
      ctx.getPin('adr4', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '3'],
      ctx.getPin('adr4', [], 'out', ['1'])
    );
    yield ctx.setPin('adr5', [], 'in1', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('adr5', [], 'in1', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'adr5',
      [],
      'in2',
      ['0'],
      ctx.getPin('adr4', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'adr5',
      [],
      'in2',
      ['1'],
      ctx.getPin('adr4', [], 'out', ['1'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '4'],
      ctx.getPin('adr5', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '4'],
      ctx.getPin('adr5', [], 'out', ['1'])
    );
    yield ctx.setPin('adr6', [], 'in1', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('adr6', [], 'in1', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'adr6',
      [],
      'in2',
      ['0'],
      ctx.getPin('adr5', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'adr6',
      [],
      'in2',
      ['1'],
      ctx.getPin('adr5', [], 'out', ['1'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '5'],
      ctx.getPin('adr6', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '5'],
      ctx.getPin('adr6', [], 'out', ['1'])
    );
    yield ctx.setPin('adr7', [], 'in1', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('adr7', [], 'in1', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'adr7',
      [],
      'in2',
      ['0'],
      ctx.getPin('adr6', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'adr7',
      [],
      'in2',
      ['1'],
      ctx.getPin('adr6', [], 'out', ['1'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '6'],
      ctx.getPin('adr7', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '6'],
      ctx.getPin('adr7', [], 'out', ['1'])
    );
    yield ctx.setPin('adr8', [], 'in1', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('adr8', [], 'in1', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'adr8',
      [],
      'in2',
      ['0'],
      ctx.getPin('adr7', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'adr8',
      [],
      'in2',
      ['1'],
      ctx.getPin('adr7', [], 'out', ['1'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '7'],
      ctx.getPin('adr8', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '7'],
      ctx.getPin('adr8', [], 'out', ['1'])
    );
    yield ctx.setSignal('out8', ['0'], ctx.getPin('adr8', [], 'out', ['0']));
    yield ctx.setSignal('out8', ['1'], ctx.getPin('adr8', [], 'out', ['1']));
    yield ctx.setSignal('out', ['0'], ctx.getPin('mux', [], 'out', ['0']));
    yield ctx.setSignal('out', ['1'], ctx.getPin('mux', [], 'out', ['1']));
  },
  SegmentMulFix: function* (ctx) {
    yield ctx.setPin('e2m', [], 'in', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('e2m', [], 'in', ['1'], ctx.getSignal('base', ['1']));
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('nWindows', [])))
          ? 1
          : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        if (
          bigInt(bigInt(ctx.getVar('i', [])).eq(bigInt('0')) ? 1 : 0).neq(
            bigInt(0)
          )
        ) {
          {
            yield ctx.setPin(
              'windows',
              [ctx.getVar('i', [])],
              'base',
              ['0'],
              ctx.getPin('e2m', [], 'out', ['0'])
            );
            yield ctx.setPin(
              'windows',
              [ctx.getVar('i', [])],
              'base',
              ['1'],
              ctx.getPin('e2m', [], 'out', ['1'])
            );
            yield ctx.setPin(
              'cadders',
              [ctx.getVar('i', [])],
              'in1',
              ['0'],
              ctx.getPin('e2m', [], 'out', ['0'])
            );
            yield ctx.setPin(
              'cadders',
              [ctx.getVar('i', [])],
              'in1',
              ['1'],
              ctx.getPin('e2m', [], 'out', ['1'])
            );
          }
        } else {
          {
            yield ctx.setPin(
              'windows',
              [ctx.getVar('i', [])],
              'base',
              ['0'],
              ctx.getPin(
                'windows',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out8',
                ['0']
              )
            );
            yield ctx.setPin(
              'windows',
              [ctx.getVar('i', [])],
              'base',
              ['1'],
              ctx.getPin(
                'windows',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out8',
                ['1']
              )
            );
            yield ctx.setPin(
              'cadders',
              [ctx.getVar('i', [])],
              'in1',
              ['0'],
              ctx.getPin(
                'cadders',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out',
                ['0']
              )
            );
            yield ctx.setPin(
              'cadders',
              [ctx.getVar('i', [])],
              'in1',
              ['1'],
              ctx.getPin(
                'cadders',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out',
                ['1']
              )
            );
          }
        }
        if (
          bigInt(
            bigInt(ctx.getVar('i', [])).lt(
              bigInt(
                bigInt(ctx.getVar('nWindows', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__)
              )
            )
              ? 1
              : 0
          ).neq(bigInt(0))
        ) {
          {
            yield ctx.setPin(
              'cadders',
              [ctx.getVar('i', [])],
              'in2',
              ['0'],
              ctx.getPin('windows', [ctx.getVar('i', [])], 'out8', ['0'])
            );
            yield ctx.setPin(
              'cadders',
              [ctx.getVar('i', [])],
              'in2',
              ['1'],
              ctx.getPin('windows', [ctx.getVar('i', [])], 'out8', ['1'])
            );
          }
        } else {
          {
            yield ctx.setPin(
              'dblLast',
              [],
              'in',
              ['0'],
              ctx.getPin('windows', [ctx.getVar('i', [])], 'out8', ['0'])
            );
            yield ctx.setPin(
              'dblLast',
              [],
              'in',
              ['1'],
              ctx.getPin('windows', [ctx.getVar('i', [])], 'out8', ['1'])
            );
            yield ctx.setPin(
              'cadders',
              [ctx.getVar('i', [])],
              'in2',
              ['0'],
              ctx.getPin('dblLast', [], 'out', ['0'])
            );
            yield ctx.setPin(
              'cadders',
              [ctx.getVar('i', [])],
              'in2',
              ['1'],
              ctx.getPin('dblLast', [], 'out', ['1'])
            );
          }
        }
        for (
          ctx.setVar('j', [], '0');
          bigInt(bigInt(ctx.getVar('j', [])).lt(bigInt('3')) ? 1 : 0).neq(
            bigInt(0)
          );
          ctx
            .setVar(
              'j',
              [],
              bigInt(ctx.getVar('j', [])).add(bigInt('1')).mod(__P__)
            )
            .add(__P__)
            .sub(bigInt(1))
            .mod(__P__)
        ) {
          {
            yield ctx.setPin(
              'windows',
              [ctx.getVar('i', [])],
              'in',
              [ctx.getVar('j', [])],
              ctx.getSignal('e', [
                bigInt(
                  bigInt('3')
                    .mul(bigInt(ctx.getVar('i', [])))
                    .mod(__P__)
                )
                  .add(bigInt(ctx.getVar('j', [])))
                  .mod(__P__),
              ])
            );
          }
        }
      }
    }
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('nWindows', [])))
          ? 1
          : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        if (
          bigInt(bigInt(ctx.getVar('i', [])).eq(bigInt('0')) ? 1 : 0).neq(
            bigInt(0)
          )
        ) {
          {
            yield ctx.setPin(
              'adders',
              [ctx.getVar('i', [])],
              'in1',
              ['0'],
              ctx.getPin('dblLast', [], 'out', ['0'])
            );
            yield ctx.setPin(
              'adders',
              [ctx.getVar('i', [])],
              'in1',
              ['1'],
              ctx.getPin('dblLast', [], 'out', ['1'])
            );
          }
        } else {
          {
            yield ctx.setPin(
              'adders',
              [ctx.getVar('i', [])],
              'in1',
              ['0'],
              ctx.getPin(
                'adders',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out',
                ['0']
              )
            );
            yield ctx.setPin(
              'adders',
              [ctx.getVar('i', [])],
              'in1',
              ['1'],
              ctx.getPin(
                'adders',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out',
                ['1']
              )
            );
          }
        }
        yield ctx.setPin(
          'adders',
          [ctx.getVar('i', [])],
          'in2',
          ['0'],
          ctx.getPin('windows', [ctx.getVar('i', [])], 'out', ['0'])
        );
        yield ctx.setPin(
          'adders',
          [ctx.getVar('i', [])],
          'in2',
          ['1'],
          ctx.getPin('windows', [ctx.getVar('i', [])], 'out', ['1'])
        );
      }
    }
    yield ctx.setPin(
      'm2e',
      [],
      'in',
      ['0'],
      ctx.getPin(
        'adders',
        [
          bigInt(ctx.getVar('nWindows', []))
            .add(__P__)
            .sub(bigInt('1'))
            .mod(__P__),
        ],
        'out',
        ['0']
      )
    );
    yield ctx.setPin(
      'm2e',
      [],
      'in',
      ['1'],
      ctx.getPin(
        'adders',
        [
          bigInt(ctx.getVar('nWindows', []))
            .add(__P__)
            .sub(bigInt('1'))
            .mod(__P__),
        ],
        'out',
        ['1']
      )
    );
    yield ctx.setPin(
      'cm2e',
      [],
      'in',
      ['0'],
      ctx.getPin(
        'cadders',
        [
          bigInt(ctx.getVar('nWindows', []))
            .add(__P__)
            .sub(bigInt('1'))
            .mod(__P__),
        ],
        'out',
        ['0']
      )
    );
    yield ctx.setPin(
      'cm2e',
      [],
      'in',
      ['1'],
      ctx.getPin(
        'cadders',
        [
          bigInt(ctx.getVar('nWindows', []))
            .add(__P__)
            .sub(bigInt('1'))
            .mod(__P__),
        ],
        'out',
        ['1']
      )
    );
    yield ctx.setPin('cAdd', [], 'x1', [], ctx.getPin('m2e', [], 'out', ['0']));
    yield ctx.setPin('cAdd', [], 'y1', [], ctx.getPin('m2e', [], 'out', ['1']));
    yield ctx.setPin(
      'cAdd',
      [],
      'x2',
      [],
      __P__.sub(bigInt(ctx.getPin('cm2e', [], 'out', ['0']))).mod(__P__)
    );
    yield ctx.setPin(
      'cAdd',
      [],
      'y2',
      [],
      ctx.getPin('cm2e', [], 'out', ['1'])
    );
    yield ctx.setSignal('out', ['0'], ctx.getPin('cAdd', [], 'xout', []));
    yield ctx.setSignal('out', ['1'], ctx.getPin('cAdd', [], 'yout', []));
    yield ctx.setSignal(
      'dbl',
      ['0'],
      ctx.getPin(
        'windows',
        [
          bigInt(ctx.getVar('nWindows', []))
            .add(__P__)
            .sub(bigInt('1'))
            .mod(__P__),
        ],
        'out8',
        ['0']
      )
    );
    yield ctx.setSignal(
      'dbl',
      ['1'],
      ctx.getPin(
        'windows',
        [
          bigInt(ctx.getVar('nWindows', []))
            .add(__P__)
            .sub(bigInt('1'))
            .mod(__P__),
        ],
        'out8',
        ['1']
      )
    );
  },
  EscalarMulFix: function* (ctx) {
    ctx.setVar(
      'nsegments',
      [],
      bigInt(
        bigInt(
          bigInt(ctx.getVar('n', [])).add(__P__).sub(bigInt('1')).mod(__P__)
        ).div(bigInt('246'))
      )
        .add(bigInt('1'))
        .mod(__P__)
    );
    ctx.setVar(
      'nlastsegment',
      [],
      bigInt(ctx.getVar('n', []))
        .add(__P__)
        .sub(
          bigInt(
            bigInt(
              bigInt(ctx.getVar('nsegments', []))
                .add(__P__)
                .sub(bigInt('1'))
                .mod(__P__)
            )
              .mul(bigInt('246'))
              .mod(__P__)
          )
        )
        .mod(__P__)
    );
    for (
      ctx.setVar('s', [], '0');
      bigInt(
        bigInt(ctx.getVar('s', [])).lt(bigInt(ctx.getVar('nsegments', [])))
          ? 1
          : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          's',
          [],
          bigInt(ctx.getVar('s', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        ctx.setVar(
          'nseg',
          [],
          bigInt(
            bigInt(ctx.getVar('s', [])).lt(
              bigInt(
                bigInt(ctx.getVar('nsegments', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__)
              )
            )
              ? 1
              : 0
          ).neq(bigInt(0))
            ? '246'
            : ctx.getVar('nlastsegment', [])
        );
        ctx.setVar(
          'nWindows',
          [],
          bigInt(
            bigInt(
              bigInt(ctx.getVar('nseg', []))
                .add(__P__)
                .sub(bigInt('1'))
                .mod(__P__)
            ).div(bigInt('3'))
          )
            .add(bigInt('1'))
            .mod(__P__)
        );
        for (
          ctx.setVar('i', [], '0');
          bigInt(
            bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('nseg', [])))
              ? 1
              : 0
          ).neq(bigInt(0));
          ctx
            .setVar(
              'i',
              [],
              bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
            )
            .add(__P__)
            .sub(bigInt(1))
            .mod(__P__)
        ) {
          {
            yield ctx.setPin(
              'segments',
              [ctx.getVar('s', [])],
              'e',
              [ctx.getVar('i', [])],
              ctx.getSignal('e', [
                bigInt(
                  bigInt(ctx.getVar('s', [])).mul(bigInt('246')).mod(__P__)
                )
                  .add(bigInt(ctx.getVar('i', [])))
                  .mod(__P__),
              ])
            );
          }
        }
        for (
          ctx.setVar('i', [], ctx.getVar('nseg', []));
          bigInt(
            bigInt(ctx.getVar('i', [])).lt(
              bigInt(
                bigInt(ctx.getVar('nWindows', [])).mul(bigInt('3')).mod(__P__)
              )
            )
              ? 1
              : 0
          ).neq(bigInt(0));
          ctx
            .setVar(
              'i',
              [],
              bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
            )
            .add(__P__)
            .sub(bigInt(1))
            .mod(__P__)
        ) {
          {
            yield ctx.setPin(
              'segments',
              [ctx.getVar('s', [])],
              'e',
              [ctx.getVar('i', [])],
              '0'
            );
          }
        }
        if (
          bigInt(bigInt(ctx.getVar('s', [])).eq(bigInt('0')) ? 1 : 0).neq(
            bigInt(0)
          )
        ) {
          {
            yield ctx.setPin(
              'segments',
              [ctx.getVar('s', [])],
              'base',
              ['0'],
              ctx.getVar('BASE', ['0'])
            );
            yield ctx.setPin(
              'segments',
              [ctx.getVar('s', [])],
              'base',
              ['1'],
              ctx.getVar('BASE', ['1'])
            );
          }
        } else {
          {
            yield ctx.setPin(
              'm2e',
              [
                bigInt(ctx.getVar('s', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__),
              ],
              'in',
              ['0'],
              ctx.getPin(
                'segments',
                [
                  bigInt(ctx.getVar('s', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'dbl',
                ['0']
              )
            );
            yield ctx.setPin(
              'm2e',
              [
                bigInt(ctx.getVar('s', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__),
              ],
              'in',
              ['1'],
              ctx.getPin(
                'segments',
                [
                  bigInt(ctx.getVar('s', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'dbl',
                ['1']
              )
            );
            yield ctx.setPin(
              'segments',
              [ctx.getVar('s', [])],
              'base',
              ['0'],
              ctx.getPin(
                'm2e',
                [
                  bigInt(ctx.getVar('s', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out',
                ['0']
              )
            );
            yield ctx.setPin(
              'segments',
              [ctx.getVar('s', [])],
              'base',
              ['1'],
              ctx.getPin(
                'm2e',
                [
                  bigInt(ctx.getVar('s', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out',
                ['1']
              )
            );
            if (
              bigInt(bigInt(ctx.getVar('s', [])).eq(bigInt('1')) ? 1 : 0).neq(
                bigInt(0)
              )
            ) {
              {
                yield ctx.setPin(
                  'adders',
                  [
                    bigInt(ctx.getVar('s', []))
                      .add(__P__)
                      .sub(bigInt('1'))
                      .mod(__P__),
                  ],
                  'x1',
                  [],
                  ctx.getPin(
                    'segments',
                    [
                      bigInt(ctx.getVar('s', []))
                        .add(__P__)
                        .sub(bigInt('1'))
                        .mod(__P__),
                    ],
                    'out',
                    ['0']
                  )
                );
                yield ctx.setPin(
                  'adders',
                  [
                    bigInt(ctx.getVar('s', []))
                      .add(__P__)
                      .sub(bigInt('1'))
                      .mod(__P__),
                  ],
                  'y1',
                  [],
                  ctx.getPin(
                    'segments',
                    [
                      bigInt(ctx.getVar('s', []))
                        .add(__P__)
                        .sub(bigInt('1'))
                        .mod(__P__),
                    ],
                    'out',
                    ['1']
                  )
                );
              }
            } else {
              {
                yield ctx.setPin(
                  'adders',
                  [
                    bigInt(ctx.getVar('s', []))
                      .add(__P__)
                      .sub(bigInt('1'))
                      .mod(__P__),
                  ],
                  'x1',
                  [],
                  ctx.getPin(
                    'adders',
                    [
                      bigInt(ctx.getVar('s', []))
                        .add(__P__)
                        .sub(bigInt('2'))
                        .mod(__P__),
                    ],
                    'xout',
                    []
                  )
                );
                yield ctx.setPin(
                  'adders',
                  [
                    bigInt(ctx.getVar('s', []))
                      .add(__P__)
                      .sub(bigInt('1'))
                      .mod(__P__),
                  ],
                  'y1',
                  [],
                  ctx.getPin(
                    'adders',
                    [
                      bigInt(ctx.getVar('s', []))
                        .add(__P__)
                        .sub(bigInt('2'))
                        .mod(__P__),
                    ],
                    'yout',
                    []
                  )
                );
              }
            }
            yield ctx.setPin(
              'adders',
              [
                bigInt(ctx.getVar('s', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__),
              ],
              'x2',
              [],
              ctx.getPin('segments', [ctx.getVar('s', [])], 'out', ['0'])
            );
            yield ctx.setPin(
              'adders',
              [
                bigInt(ctx.getVar('s', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__),
              ],
              'y2',
              [],
              ctx.getPin('segments', [ctx.getVar('s', [])], 'out', ['1'])
            );
          }
        }
      }
    }
    if (
      bigInt(bigInt(ctx.getVar('nsegments', [])).eq(bigInt('1')) ? 1 : 0).neq(
        bigInt(0)
      )
    ) {
      {
        yield ctx.setSignal(
          'out',
          ['0'],
          ctx.getPin('segments', ['0'], 'out', ['0'])
        );
        yield ctx.setSignal(
          'out',
          ['1'],
          ctx.getPin('segments', ['0'], 'out', ['1'])
        );
      }
    } else {
      {
        yield ctx.setSignal(
          'out',
          ['0'],
          ctx.getPin(
            'adders',
            [
              bigInt(ctx.getVar('nsegments', []))
                .add(__P__)
                .sub(bigInt('2'))
                .mod(__P__),
            ],
            'xout',
            []
          )
        );
        yield ctx.setSignal(
          'out',
          ['1'],
          ctx.getPin(
            'adders',
            [
              bigInt(ctx.getVar('nsegments', []))
                .add(__P__)
                .sub(bigInt('2'))
                .mod(__P__),
            ],
            'yout',
            []
          )
        );
      }
    }
  },
  BabyAdd: function* (ctx) {
    ctx.setVar('a', [], '168700');
    ctx.setVar('d', [], '168696');
    yield ctx.setSignal(
      'beta',
      [],
      bigInt(ctx.getSignal('x1', []))
        .mul(bigInt(ctx.getSignal('y2', [])))
        .mod(__P__)
    );
    yield ctx.setSignal(
      'gamma',
      [],
      bigInt(ctx.getSignal('y1', []))
        .mul(bigInt(ctx.getSignal('x2', [])))
        .mod(__P__)
    );
    yield ctx.setSignal(
      'delta',
      [],
      bigInt(
        bigInt(
          bigInt(__P__.sub(bigInt(ctx.getVar('a', []))).mod(__P__))
            .mul(bigInt(ctx.getSignal('x1', [])))
            .mod(__P__)
        )
          .add(bigInt(ctx.getSignal('y1', [])))
          .mod(__P__)
      )
        .mul(
          bigInt(
            bigInt(ctx.getSignal('x2', []))
              .add(bigInt(ctx.getSignal('y2', [])))
              .mod(__P__)
          )
        )
        .mod(__P__)
    );
    yield ctx.setSignal(
      'tau',
      [],
      bigInt(ctx.getSignal('beta', []))
        .mul(bigInt(ctx.getSignal('gamma', [])))
        .mod(__P__)
    );
    yield ctx.setSignal(
      'xout',
      [],
      bigInt(
        bigInt(ctx.getSignal('beta', []))
          .add(bigInt(ctx.getSignal('gamma', [])))
          .mod(__P__)
      )
        .mul(
          bigInt(
            bigInt('1')
              .add(
                bigInt(
                  bigInt(ctx.getVar('d', []))
                    .mul(bigInt(ctx.getSignal('tau', [])))
                    .mod(__P__)
                )
              )
              .mod(__P__)
          ).inverse(__P__)
        )
        .mod(__P__)
    );
    ctx.assert(
      bigInt(
        bigInt('1')
          .add(
            bigInt(
              bigInt(ctx.getVar('d', []))
                .mul(bigInt(ctx.getSignal('tau', [])))
                .mod(__P__)
            )
          )
          .mod(__P__)
      )
        .mul(bigInt(ctx.getSignal('xout', [])))
        .mod(__P__),
      bigInt(ctx.getSignal('beta', []))
        .add(bigInt(ctx.getSignal('gamma', [])))
        .mod(__P__),
      '/Users/rstorm/repos/stormdapps/tornado-core/node_modules/circomlib/circuits/babyjub.circom:45:4'
    );
    yield ctx.setSignal(
      'yout',
      [],
      bigInt(
        bigInt(
          bigInt(ctx.getSignal('delta', []))
            .add(
              bigInt(
                bigInt(ctx.getVar('a', []))
                  .mul(bigInt(ctx.getSignal('beta', [])))
                  .mod(__P__)
              )
            )
            .mod(__P__)
        )
          .add(__P__)
          .sub(bigInt(ctx.getSignal('gamma', [])))
          .mod(__P__)
      )
        .mul(
          bigInt(
            bigInt('1')
              .add(__P__)
              .sub(
                bigInt(
                  bigInt(ctx.getVar('d', []))
                    .mul(bigInt(ctx.getSignal('tau', [])))
                    .mod(__P__)
                )
              )
              .mod(__P__)
          ).inverse(__P__)
        )
        .mod(__P__)
    );
    ctx.assert(
      bigInt(
        bigInt('1')
          .add(__P__)
          .sub(
            bigInt(
              bigInt(ctx.getVar('d', []))
                .mul(bigInt(ctx.getSignal('tau', [])))
                .mod(__P__)
            )
          )
          .mod(__P__)
      )
        .mul(bigInt(ctx.getSignal('yout', [])))
        .mod(__P__),
      bigInt(
        bigInt(ctx.getSignal('delta', []))
          .add(
            bigInt(
              bigInt(ctx.getVar('a', []))
                .mul(bigInt(ctx.getSignal('beta', [])))
                .mod(__P__)
            )
          )
          .mod(__P__)
      )
        .add(__P__)
        .sub(bigInt(ctx.getSignal('gamma', [])))
        .mod(__P__),
      '/Users/rstorm/repos/stormdapps/tornado-core/node_modules/circomlib/circuits/babyjub.circom:48:4'
    );
  },
  BabyDbl: function* (ctx) {
    yield ctx.setPin('adder', [], 'x1', [], ctx.getSignal('x', []));
    yield ctx.setPin('adder', [], 'y1', [], ctx.getSignal('y', []));
    yield ctx.setPin('adder', [], 'x2', [], ctx.getSignal('x', []));
    yield ctx.setPin('adder', [], 'y2', [], ctx.getSignal('y', []));
    yield ctx.setSignal('xout', [], ctx.getPin('adder', [], 'xout', []));
    yield ctx.setSignal('yout', [], ctx.getPin('adder', [], 'yout', []));
  },
  BabyCheck: function* (ctx) {
    ctx.setVar('a', [], '168700');
    ctx.setVar('d', [], '168696');
    yield ctx.setSignal(
      'x2',
      [],
      bigInt(ctx.getSignal('x', []))
        .mul(bigInt(ctx.getSignal('x', [])))
        .mod(__P__)
    );
    yield ctx.setSignal(
      'y2',
      [],
      bigInt(ctx.getSignal('y', []))
        .mul(bigInt(ctx.getSignal('y', [])))
        .mod(__P__)
    );
    ctx.assert(
      bigInt(
        bigInt(ctx.getVar('a', []))
          .mul(bigInt(ctx.getSignal('x2', [])))
          .mod(__P__)
      )
        .add(bigInt(ctx.getSignal('y2', [])))
        .mod(__P__),
      bigInt('1')
        .add(
          bigInt(
            bigInt(
              bigInt(ctx.getVar('d', []))
                .mul(bigInt(ctx.getSignal('x2', [])))
                .mod(__P__)
            )
              .mul(bigInt(ctx.getSignal('y2', [])))
              .mod(__P__)
          )
        )
        .mod(__P__),
      'undefined:81:4'
    );
  },
  BabyPbk: function* (ctx) {
    ctx.setVar(
      'BASE8',
      [],
      [
        '5299619240641551281634865583518297030282874472190772894086521144482721001553',
        '16950150798460657717958625567821834550301663161624707787222815936182638968203',
      ]
    );
    yield ctx.setPin('pvkBits', [], 'in', [], ctx.getSignal('in', []));
    for (
      ctx.setVar('i', [], '0');
      bigInt(bigInt(ctx.getVar('i', [])).lt(bigInt('253')) ? 1 : 0).neq(
        bigInt(0)
      );
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setPin(
          'mulFix',
          [],
          'e',
          [ctx.getVar('i', [])],
          ctx.getPin('pvkBits', [], 'out', [ctx.getVar('i', [])])
        );
      }
    }
    yield ctx.setSignal('Ax', [], ctx.getPin('mulFix', [], 'out', ['0']));
    yield ctx.setSignal('Ay', [], ctx.getPin('mulFix', [], 'out', ['1']));
  },
  Window4: function* (ctx) {
    yield ctx.setPin('mux', [], 's', ['0'], ctx.getSignal('in', ['0']));
    yield ctx.setPin('mux', [], 's', ['1'], ctx.getSignal('in', ['1']));
    yield ctx.setPin('mux', [], 's', ['2'], ctx.getSignal('in', ['2']));
    yield ctx.setPin('mux', [], 'c', ['0', '0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('mux', [], 'c', ['1', '0'], ctx.getSignal('base', ['1']));
    yield ctx.setPin('dbl2', [], 'in', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('dbl2', [], 'in', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '1'],
      ctx.getPin('dbl2', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '1'],
      ctx.getPin('dbl2', [], 'out', ['1'])
    );
    yield ctx.setPin('adr3', [], 'in1', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('adr3', [], 'in1', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'adr3',
      [],
      'in2',
      ['0'],
      ctx.getPin('dbl2', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'adr3',
      [],
      'in2',
      ['1'],
      ctx.getPin('dbl2', [], 'out', ['1'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '2'],
      ctx.getPin('adr3', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '2'],
      ctx.getPin('adr3', [], 'out', ['1'])
    );
    yield ctx.setPin('adr4', [], 'in1', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('adr4', [], 'in1', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'adr4',
      [],
      'in2',
      ['0'],
      ctx.getPin('adr3', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'adr4',
      [],
      'in2',
      ['1'],
      ctx.getPin('adr3', [], 'out', ['1'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '3'],
      ctx.getPin('adr4', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '3'],
      ctx.getPin('adr4', [], 'out', ['1'])
    );
    yield ctx.setPin('adr5', [], 'in1', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('adr5', [], 'in1', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'adr5',
      [],
      'in2',
      ['0'],
      ctx.getPin('adr4', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'adr5',
      [],
      'in2',
      ['1'],
      ctx.getPin('adr4', [], 'out', ['1'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '4'],
      ctx.getPin('adr5', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '4'],
      ctx.getPin('adr5', [], 'out', ['1'])
    );
    yield ctx.setPin('adr6', [], 'in1', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('adr6', [], 'in1', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'adr6',
      [],
      'in2',
      ['0'],
      ctx.getPin('adr5', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'adr6',
      [],
      'in2',
      ['1'],
      ctx.getPin('adr5', [], 'out', ['1'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '5'],
      ctx.getPin('adr6', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '5'],
      ctx.getPin('adr6', [], 'out', ['1'])
    );
    yield ctx.setPin('adr7', [], 'in1', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('adr7', [], 'in1', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'adr7',
      [],
      'in2',
      ['0'],
      ctx.getPin('adr6', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'adr7',
      [],
      'in2',
      ['1'],
      ctx.getPin('adr6', [], 'out', ['1'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '6'],
      ctx.getPin('adr7', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '6'],
      ctx.getPin('adr7', [], 'out', ['1'])
    );
    yield ctx.setPin('adr8', [], 'in1', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('adr8', [], 'in1', ['1'], ctx.getSignal('base', ['1']));
    yield ctx.setPin(
      'adr8',
      [],
      'in2',
      ['0'],
      ctx.getPin('adr7', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'adr8',
      [],
      'in2',
      ['1'],
      ctx.getPin('adr7', [], 'out', ['1'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['0', '7'],
      ctx.getPin('adr8', [], 'out', ['0'])
    );
    yield ctx.setPin(
      'mux',
      [],
      'c',
      ['1', '7'],
      ctx.getPin('adr8', [], 'out', ['1'])
    );
    yield ctx.setSignal('out8', ['0'], ctx.getPin('adr8', [], 'out', ['0']));
    yield ctx.setSignal('out8', ['1'], ctx.getPin('adr8', [], 'out', ['1']));
    yield ctx.setSignal('out', ['0'], ctx.getPin('mux', [], 'out', ['0']));
    yield ctx.setSignal(
      'out',
      ['1'],
      bigInt(
        bigInt(
          bigInt(
            __P__.sub(bigInt(ctx.getPin('mux', [], 'out', ['1']))).mod(__P__)
          )
            .mul(bigInt('2'))
            .mod(__P__)
        )
          .mul(bigInt(ctx.getSignal('in', ['3'])))
          .mod(__P__)
      )
        .add(bigInt(ctx.getPin('mux', [], 'out', ['1'])))
        .mod(__P__)
    );
  },
  Segment: function* (ctx) {
    yield ctx.setPin('e2m', [], 'in', ['0'], ctx.getSignal('base', ['0']));
    yield ctx.setPin('e2m', [], 'in', ['1'], ctx.getSignal('base', ['1']));
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('nWindows', [])))
          ? 1
          : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        if (
          bigInt(bigInt(ctx.getVar('i', [])).eq(bigInt('0')) ? 1 : 0).neq(
            bigInt(0)
          )
        ) {
          {
            yield ctx.setPin(
              'windows',
              [ctx.getVar('i', [])],
              'base',
              ['0'],
              ctx.getPin('e2m', [], 'out', ['0'])
            );
            yield ctx.setPin(
              'windows',
              [ctx.getVar('i', [])],
              'base',
              ['1'],
              ctx.getPin('e2m', [], 'out', ['1'])
            );
          }
        } else {
          {
            yield ctx.setPin(
              'doublers1',
              [
                bigInt(ctx.getVar('i', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__),
              ],
              'in',
              ['0'],
              ctx.getPin(
                'windows',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out8',
                ['0']
              )
            );
            yield ctx.setPin(
              'doublers1',
              [
                bigInt(ctx.getVar('i', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__),
              ],
              'in',
              ['1'],
              ctx.getPin(
                'windows',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out8',
                ['1']
              )
            );
            yield ctx.setPin(
              'doublers2',
              [
                bigInt(ctx.getVar('i', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__),
              ],
              'in',
              ['0'],
              ctx.getPin(
                'doublers1',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out',
                ['0']
              )
            );
            yield ctx.setPin(
              'doublers2',
              [
                bigInt(ctx.getVar('i', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__),
              ],
              'in',
              ['1'],
              ctx.getPin(
                'doublers1',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out',
                ['1']
              )
            );
            yield ctx.setPin(
              'windows',
              [ctx.getVar('i', [])],
              'base',
              ['0'],
              ctx.getPin(
                'doublers2',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out',
                ['0']
              )
            );
            yield ctx.setPin(
              'windows',
              [ctx.getVar('i', [])],
              'base',
              ['1'],
              ctx.getPin(
                'doublers2',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'out',
                ['1']
              )
            );
            if (
              bigInt(bigInt(ctx.getVar('i', [])).eq(bigInt('1')) ? 1 : 0).neq(
                bigInt(0)
              )
            ) {
              {
                yield ctx.setPin(
                  'adders',
                  [
                    bigInt(ctx.getVar('i', []))
                      .add(__P__)
                      .sub(bigInt('1'))
                      .mod(__P__),
                  ],
                  'in1',
                  ['0'],
                  ctx.getPin('windows', ['0'], 'out', ['0'])
                );
                yield ctx.setPin(
                  'adders',
                  [
                    bigInt(ctx.getVar('i', []))
                      .add(__P__)
                      .sub(bigInt('1'))
                      .mod(__P__),
                  ],
                  'in1',
                  ['1'],
                  ctx.getPin('windows', ['0'], 'out', ['1'])
                );
              }
            } else {
              {
                yield ctx.setPin(
                  'adders',
                  [
                    bigInt(ctx.getVar('i', []))
                      .add(__P__)
                      .sub(bigInt('1'))
                      .mod(__P__),
                  ],
                  'in1',
                  ['0'],
                  ctx.getPin(
                    'adders',
                    [
                      bigInt(ctx.getVar('i', []))
                        .add(__P__)
                        .sub(bigInt('2'))
                        .mod(__P__),
                    ],
                    'out',
                    ['0']
                  )
                );
                yield ctx.setPin(
                  'adders',
                  [
                    bigInt(ctx.getVar('i', []))
                      .add(__P__)
                      .sub(bigInt('1'))
                      .mod(__P__),
                  ],
                  'in1',
                  ['1'],
                  ctx.getPin(
                    'adders',
                    [
                      bigInt(ctx.getVar('i', []))
                        .add(__P__)
                        .sub(bigInt('2'))
                        .mod(__P__),
                    ],
                    'out',
                    ['1']
                  )
                );
              }
            }
            yield ctx.setPin(
              'adders',
              [
                bigInt(ctx.getVar('i', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__),
              ],
              'in2',
              ['0'],
              ctx.getPin('windows', [ctx.getVar('i', [])], 'out', ['0'])
            );
            yield ctx.setPin(
              'adders',
              [
                bigInt(ctx.getVar('i', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__),
              ],
              'in2',
              ['1'],
              ctx.getPin('windows', [ctx.getVar('i', [])], 'out', ['1'])
            );
          }
        }
        for (
          ctx.setVar('j', [], '0');
          bigInt(bigInt(ctx.getVar('j', [])).lt(bigInt('4')) ? 1 : 0).neq(
            bigInt(0)
          );
          ctx
            .setVar(
              'j',
              [],
              bigInt(ctx.getVar('j', [])).add(bigInt('1')).mod(__P__)
            )
            .add(__P__)
            .sub(bigInt(1))
            .mod(__P__)
        ) {
          {
            yield ctx.setPin(
              'windows',
              [ctx.getVar('i', [])],
              'in',
              [ctx.getVar('j', [])],
              ctx.getSignal('in', [
                bigInt(
                  bigInt('4')
                    .mul(bigInt(ctx.getVar('i', [])))
                    .mod(__P__)
                )
                  .add(bigInt(ctx.getVar('j', [])))
                  .mod(__P__),
              ])
            );
          }
        }
      }
    }
    if (
      bigInt(bigInt(ctx.getVar('nWindows', [])).gt(bigInt('1')) ? 1 : 0).neq(
        bigInt(0)
      )
    ) {
      {
        yield ctx.setPin(
          'm2e',
          [],
          'in',
          ['0'],
          ctx.getPin(
            'adders',
            [
              bigInt(ctx.getVar('nWindows', []))
                .add(__P__)
                .sub(bigInt('2'))
                .mod(__P__),
            ],
            'out',
            ['0']
          )
        );
        yield ctx.setPin(
          'm2e',
          [],
          'in',
          ['1'],
          ctx.getPin(
            'adders',
            [
              bigInt(ctx.getVar('nWindows', []))
                .add(__P__)
                .sub(bigInt('2'))
                .mod(__P__),
            ],
            'out',
            ['1']
          )
        );
      }
    } else {
      {
        yield ctx.setPin(
          'm2e',
          [],
          'in',
          ['0'],
          ctx.getPin('windows', ['0'], 'out', ['0'])
        );
        yield ctx.setPin(
          'm2e',
          [],
          'in',
          ['1'],
          ctx.getPin('windows', ['0'], 'out', ['1'])
        );
      }
    }
    yield ctx.setSignal('out', ['0'], ctx.getPin('m2e', [], 'out', ['0']));
    yield ctx.setSignal('out', ['1'], ctx.getPin('m2e', [], 'out', ['1']));
  },
  Pedersen: function* (ctx) {
    ctx.setVar(
      'BASE',
      [],
      [
        [
          '10457101036533406547632367118273992217979173478358440826365724437999023779287',
          '19824078218392094440610104313265183977899662750282163392862422243483260492317',
        ],
        [
          '2671756056509184035029146175565761955751135805354291559563293617232983272177',
          '2663205510731142763556352975002641716101654201788071096152948830924149045094',
        ],
        [
          '5802099305472655231388284418920769829666717045250560929368476121199858275951',
          '5980429700218124965372158798884772646841287887664001482443826541541529227896',
        ],
        [
          '7107336197374528537877327281242680114152313102022415488494307685842428166594',
          '2857869773864086953506483169737724679646433914307247183624878062391496185654',
        ],
        [
          '20265828622013100949498132415626198973119240347465898028410217039057588424236',
          '1160461593266035632937973507065134938065359936056410650153315956301179689506',
        ],
        [
          '1487999857809287756929114517587739322941449154962237464737694709326309567994',
          '14017256862867289575056460215526364897734808720610101650676790868051368668003',
        ],
        [
          '14618644331049802168996997831720384953259095788558646464435263343433563860015',
          '13115243279999696210147231297848654998887864576952244320558158620692603342236',
        ],
        [
          '6814338563135591367010655964669793483652536871717891893032616415581401894627',
          '13660303521961041205824633772157003587453809761793065294055279768121314853695',
        ],
        [
          '3571615583211663069428808372184817973703476260057504149923239576077102575715',
          '11981351099832644138306422070127357074117642951423551606012551622164230222506',
        ],
        [
          '18597552580465440374022635246985743886550544261632147935254624835147509493269',
          '6753322320275422086923032033899357299485124665258735666995435957890214041481',
        ],
      ]
    );
    ctx.setVar(
      'nSegments',
      [],
      bigInt(
        bigInt(
          bigInt(ctx.getVar('n', [])).add(__P__).sub(bigInt('1')).mod(__P__)
        ).div(bigInt('200'))
      )
        .add(bigInt('1'))
        .mod(__P__)
    );
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('nSegments', [])))
          ? 1
          : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        ctx.setVar(
          'nBits',
          [],
          bigInt(
            bigInt(ctx.getVar('i', [])).eq(
              bigInt(
                bigInt(ctx.getVar('nSegments', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__)
              )
            )
              ? 1
              : 0
          ).neq(bigInt(0))
            ? bigInt(ctx.getVar('n', []))
                .add(__P__)
                .sub(
                  bigInt(
                    bigInt(
                      bigInt(ctx.getVar('nSegments', []))
                        .add(__P__)
                        .sub(bigInt('1'))
                        .mod(__P__)
                    )
                      .mul(bigInt('200'))
                      .mod(__P__)
                  )
                )
                .mod(__P__)
            : '200'
        );
        ctx.setVar(
          'nWindows',
          [],
          bigInt(
            bigInt(
              bigInt(ctx.getVar('nBits', []))
                .add(__P__)
                .sub(bigInt('1'))
                .mod(__P__)
            ).div(bigInt('4'))
          )
            .add(bigInt('1'))
            .mod(__P__)
        );
        yield ctx.setPin(
          'segments',
          [ctx.getVar('i', [])],
          'base',
          ['0'],
          ctx.getVar('BASE', [ctx.getVar('i', []), '0'])
        );
        yield ctx.setPin(
          'segments',
          [ctx.getVar('i', [])],
          'base',
          ['1'],
          ctx.getVar('BASE', [ctx.getVar('i', []), '1'])
        );
        for (
          ctx.setVar('j', [], '0');
          bigInt(
            bigInt(ctx.getVar('j', [])).lt(bigInt(ctx.getVar('nBits', [])))
              ? 1
              : 0
          ).neq(bigInt(0));
          ctx
            .setVar(
              'j',
              [],
              bigInt(ctx.getVar('j', [])).add(bigInt('1')).mod(__P__)
            )
            .add(__P__)
            .sub(bigInt(1))
            .mod(__P__)
        ) {
          {
            yield ctx.setPin(
              'segments',
              [ctx.getVar('i', [])],
              'in',
              [ctx.getVar('j', [])],
              ctx.getSignal('in', [
                bigInt(
                  bigInt(ctx.getVar('i', [])).mul(bigInt('200')).mod(__P__)
                )
                  .add(bigInt(ctx.getVar('j', [])))
                  .mod(__P__),
              ])
            );
          }
        }
        for (
          ctx.setVar('j', [], ctx.getVar('nBits', []));
          bigInt(
            bigInt(ctx.getVar('j', [])).lt(
              bigInt(
                bigInt(ctx.getVar('nWindows', [])).mul(bigInt('4')).mod(__P__)
              )
            )
              ? 1
              : 0
          ).neq(bigInt(0));
          ctx
            .setVar(
              'j',
              [],
              bigInt(ctx.getVar('j', [])).add(bigInt('1')).mod(__P__)
            )
            .add(__P__)
            .sub(bigInt(1))
            .mod(__P__)
        ) {
          {
            yield ctx.setPin(
              'segments',
              [ctx.getVar('i', [])],
              'in',
              [ctx.getVar('j', [])],
              '0'
            );
          }
        }
      }
    }
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(
          bigInt(
            bigInt(ctx.getVar('nSegments', []))
              .add(__P__)
              .sub(bigInt('1'))
              .mod(__P__)
          )
        )
          ? 1
          : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        if (
          bigInt(bigInt(ctx.getVar('i', [])).eq(bigInt('0')) ? 1 : 0).neq(
            bigInt(0)
          )
        ) {
          {
            yield ctx.setPin(
              'adders',
              [ctx.getVar('i', [])],
              'x1',
              [],
              ctx.getPin('segments', ['0'], 'out', ['0'])
            );
            yield ctx.setPin(
              'adders',
              [ctx.getVar('i', [])],
              'y1',
              [],
              ctx.getPin('segments', ['0'], 'out', ['1'])
            );
            yield ctx.setPin(
              'adders',
              [ctx.getVar('i', [])],
              'x2',
              [],
              ctx.getPin('segments', ['1'], 'out', ['0'])
            );
            yield ctx.setPin(
              'adders',
              [ctx.getVar('i', [])],
              'y2',
              [],
              ctx.getPin('segments', ['1'], 'out', ['1'])
            );
          }
        } else {
          {
            yield ctx.setPin(
              'adders',
              [ctx.getVar('i', [])],
              'x1',
              [],
              ctx.getPin(
                'adders',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'xout',
                []
              )
            );
            yield ctx.setPin(
              'adders',
              [ctx.getVar('i', [])],
              'y1',
              [],
              ctx.getPin(
                'adders',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'yout',
                []
              )
            );
            yield ctx.setPin(
              'adders',
              [ctx.getVar('i', [])],
              'x2',
              [],
              ctx.getPin(
                'segments',
                [bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)],
                'out',
                ['0']
              )
            );
            yield ctx.setPin(
              'adders',
              [ctx.getVar('i', [])],
              'y2',
              [],
              ctx.getPin(
                'segments',
                [bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)],
                'out',
                ['1']
              )
            );
          }
        }
      }
    }
    if (
      bigInt(bigInt(ctx.getVar('nSegments', [])).gt(bigInt('1')) ? 1 : 0).neq(
        bigInt(0)
      )
    ) {
      {
        yield ctx.setSignal(
          'out',
          ['0'],
          ctx.getPin(
            'adders',
            [
              bigInt(ctx.getVar('nSegments', []))
                .add(__P__)
                .sub(bigInt('2'))
                .mod(__P__),
            ],
            'xout',
            []
          )
        );
        yield ctx.setSignal(
          'out',
          ['1'],
          ctx.getPin(
            'adders',
            [
              bigInt(ctx.getVar('nSegments', []))
                .add(__P__)
                .sub(bigInt('2'))
                .mod(__P__),
            ],
            'yout',
            []
          )
        );
      }
    } else {
      {
        yield ctx.setSignal(
          'out',
          ['0'],
          ctx.getPin('segments', ['0'], 'out', ['0'])
        );
        yield ctx.setSignal(
          'out',
          ['1'],
          ctx.getPin('segments', ['0'], 'out', ['1'])
        );
      }
    }
  },
  MiMCSponge: function* (ctx) {
    ctx.setVar('nRounds', [], '220');
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('nInputs', [])))
          ? 1
          : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setPin(
          'S',
          [ctx.getVar('i', [])],
          'k',
          [],
          ctx.getSignal('k', [])
        );
        if (
          bigInt(bigInt(ctx.getVar('i', [])).eq(bigInt('0')) ? 1 : 0).neq(
            bigInt(0)
          )
        ) {
          {
            yield ctx.setPin(
              'S',
              [ctx.getVar('i', [])],
              'xL_in',
              [],
              ctx.getSignal('ins', ['0'])
            );
            yield ctx.setPin('S', [ctx.getVar('i', [])], 'xR_in', [], '0');
          }
        } else {
          {
            yield ctx.setPin(
              'S',
              [ctx.getVar('i', [])],
              'xL_in',
              [],
              bigInt(
                ctx.getPin(
                  'S',
                  [
                    bigInt(ctx.getVar('i', []))
                      .add(__P__)
                      .sub(bigInt('1'))
                      .mod(__P__),
                  ],
                  'xL_out',
                  []
                )
              )
                .add(bigInt(ctx.getSignal('ins', [ctx.getVar('i', [])])))
                .mod(__P__)
            );
            yield ctx.setPin(
              'S',
              [ctx.getVar('i', [])],
              'xR_in',
              [],
              ctx.getPin(
                'S',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'xR_out',
                []
              )
            );
          }
        }
      }
    }
    yield ctx.setSignal(
      'outs',
      ['0'],
      ctx.getPin(
        'S',
        [
          bigInt(ctx.getVar('nInputs', []))
            .add(__P__)
            .sub(bigInt('1'))
            .mod(__P__),
        ],
        'xL_out',
        []
      )
    );
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(
          bigInt(
            bigInt(ctx.getVar('nOutputs', []))
              .add(__P__)
              .sub(bigInt('1'))
              .mod(__P__)
          )
        )
          ? 1
          : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setPin(
          'S',
          [
            bigInt(ctx.getVar('nInputs', []))
              .add(bigInt(ctx.getVar('i', [])))
              .mod(__P__),
          ],
          'k',
          [],
          ctx.getSignal('k', [])
        );
        yield ctx.setPin(
          'S',
          [
            bigInt(ctx.getVar('nInputs', []))
              .add(bigInt(ctx.getVar('i', [])))
              .mod(__P__),
          ],
          'xL_in',
          [],
          ctx.getPin(
            'S',
            [
              bigInt(
                bigInt(ctx.getVar('nInputs', []))
                  .add(bigInt(ctx.getVar('i', [])))
                  .mod(__P__)
              )
                .add(__P__)
                .sub(bigInt('1'))
                .mod(__P__),
            ],
            'xL_out',
            []
          )
        );
        yield ctx.setPin(
          'S',
          [
            bigInt(ctx.getVar('nInputs', []))
              .add(bigInt(ctx.getVar('i', [])))
              .mod(__P__),
          ],
          'xR_in',
          [],
          ctx.getPin(
            'S',
            [
              bigInt(
                bigInt(ctx.getVar('nInputs', []))
                  .add(bigInt(ctx.getVar('i', [])))
                  .mod(__P__)
              )
                .add(__P__)
                .sub(bigInt('1'))
                .mod(__P__),
            ],
            'xR_out',
            []
          )
        );
        yield ctx.setSignal(
          'outs',
          [bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)],
          ctx.getPin(
            'S',
            [
              bigInt(ctx.getVar('nInputs', []))
                .add(bigInt(ctx.getVar('i', [])))
                .mod(__P__),
            ],
            'xL_out',
            []
          )
        );
      }
    }
  },
  MiMCFeistel: function* (ctx) {
    ctx.setVar(
      'c_partial',
      [],
      [
        '7120861356467848435263064379192047478074060781135320967663101236819528304084',
        '5024705281721889198577876690145313457398658950011302225525409148828000436681',
        '17980351014018068290387269214713820287804403312720763401943303895585469787384',
        '19886576439381707240399940949310933992335779767309383709787331470398675714258',
        '1213715278223786725806155661738676903520350859678319590331207960381534602599',
        '18162138253399958831050545255414688239130588254891200470934232514682584734511',
        '7667462281466170157858259197976388676420847047604921256361474169980037581876',
        '7207551498477838452286210989212982851118089401128156132319807392460388436957',
        '9864183311657946807255900203841777810810224615118629957816193727554621093838',
        '4798196928559910300796064665904583125427459076060519468052008159779219347957',
        '17387238494588145257484818061490088963673275521250153686214197573695921400950',
        '10005334761930299057035055370088813230849810566234116771751925093634136574742',
        '11897542014760736209670863723231849628230383119798486487899539017466261308762',
        '16771780563523793011283273687253985566177232886900511371656074413362142152543',
        '749264854018824809464168489785113337925400687349357088413132714480582918506',
        '3683645737503705042628598550438395339383572464204988015434959428676652575331',
        '7556750851783822914673316211129907782679509728346361368978891584375551186255',
        '20391289379084797414557439284689954098721219201171527383291525676334308303023',
        '18146517657445423462330854383025300323335289319277199154920964274562014376193',
        '8080173465267536232534446836148661251987053305394647905212781979099916615292',
        '10796443006899450245502071131975731672911747129805343722228413358507805531141',
        '5404287610364961067658660283245291234008692303120470305032076412056764726509',
        '4623894483395123520243967718315330178025957095502546813929290333264120223168',
        '16845753148201777192406958674202574751725237939980634861948953189320362207797',
        '4622170486584704769521001011395820886029808520586507873417553166762370293671',
        '16688277490485052681847773549197928630624828392248424077804829676011512392564',
        '11878652861183667748838188993669912629573713271883125458838494308957689090959',
        '2436445725746972287496138382764643208791713986676129260589667864467010129482',
        '1888098689545151571063267806606510032698677328923740058080630641742325067877',
        '148924106504065664829055598316821983869409581623245780505601526786791681102',
        '18875020877782404439294079398043479420415331640996249745272087358069018086569',
        '15189693413320228845990326214136820307649565437237093707846682797649429515840',
        '19669450123472657781282985229369348220906547335081730205028099210442632534079',
        '5521922218264623411380547905210139511350706092570900075727555783240701821773',
        '4144769320246558352780591737261172907511489963810975650573703217887429086546',
        '10097732913112662248360143041019433907849917041759137293018029019134392559350',
        '1720059427972723034107765345743336447947522473310069975142483982753181038321',
        '6302388219880227251325608388535181451187131054211388356563634768253301290116',
        '6745410632962119604799318394592010194450845483518862700079921360015766217097',
        '10858157235265583624235850660462324469799552996870780238992046963007491306222',
        '20241898894740093733047052816576694435372877719072347814065227797906130857593',
        '10165780782761211520836029617746977303303335603838343292431760011576528327409',
        '2832093654883670345969792724123161241696170611611744759675180839473215203706',
        '153011722355526826233082383360057587249818749719433916258246100068258954737',
        '20196970640587451358539129330170636295243141659030208529338914906436009086943',
        '3180973917010545328313139835982464870638521890385603025657430208141494469656',
        '17198004293191777441573635123110935015228014028618868252989374962722329283022',
        '7642160509228669138628515458941659189680509753651629476399516332224325757132',
        '19346204940546791021518535594447257347218878114049998691060016493806845179755',
        '11501810868606870391127866188394535330696206817602260610801897042898616817272',
        '3113973447392053821824427670386252797811804954746053461397972968381571297505',
        '6545064306297957002139416752334741502722251869537551068239642131448768236585',
        '5203908808704813498389265425172875593837960384349653691918590736979872578408',
        '2246692432011290582160062129070762007374502637007107318105405626910313810224',
        '11760570435432189127645691249600821064883781677693087773459065574359292849137',
        '5543749482491340532547407723464609328207990784853381797689466144924198391839',
        '8837549193990558762776520822018694066937602576881497343584903902880277769302',
        '12855514863299373699594410385788943772765811961581749194183533625311486462501',
        '5363660674689121676875069134269386492382220935599781121306637800261912519729',
        '13162342403579303950549728848130828093497701266240457479693991108217307949435',
        '916941639326869583414469202910306428966657806899788970948781207501251816730',
        '15618589556584434434009868216186115416835494805174158488636000580759692174228',
        '8959562060028569701043973060670353733575345393653685776974948916988033453971',
        '16390754464333401712265575949874369157699293840516802426621216808905079127650',
        '168282396747788514908709091757591226095443902501365500003618183905496160435',
        '8327443473179334761744301768309008451162322941906921742120510244986704677004',
        '17213012626801210615058753489149961717422101711567228037597150941152495100640',
        '10394369641533736715250242399198097296122982486516256408681925424076248952280',
        '17784386835392322654196171115293700800825771210400152504776806618892170162248',
        '16533189939837087893364000390641148516479148564190420358849587959161226782982',
        '18725396114211370207078434315900726338547621160475533496863298091023511945076',
        '7132325028834551397904855671244375895110341505383911719294705267624034122405',
        '148317947440800089795933930720822493695520852448386394775371401743494965187',
        '19001050671757720352890779127693793630251266879994702723636759889378387053056',
        '18824274411769830274877839365728651108434404855803844568234862945613766611460',
        '12771414330193951156383998390424063470766226667986423961689712557338777174205',
        '11332046574800279729678603488745295198038913503395629790213378101166488244657',
        '9607550223176946388146938069307456967842408600269548190739947540821716354749',
        '8756385288462344550200229174435953103162307705310807828651304665320046782583',
        '176061952957067086877570020242717222844908281373122372938833890096257042779',
        '12200212977482648306758992405065921724409841940671166017620928947866825250857',
        '10868453624107875516866146499877130701929063632959660262366632833504750028858',
        '2016095394399807253596787752134573207202567875457560571095586743878953450738',
        '21815578223768330433802113452339488275704145896544481092014911825656390567514',
        '4923772847693564777744725640710197015181591950368494148029046443433103381621',
        '1813584943682214789802230765734821149202472893379265320098816901270224589984',
        '10810123816265612772922113403831964815724109728287572256602010709288980656498',
        '1153669123397255702524721206511185557982017410156956216465120456256288427021',
        '5007518659266430200134478928344522649876467369278722765097865662497773767152',
        '2511432546938591792036639990606464315121646668029252285288323664350666551637',
        '32883284540320451295484135704808083452381176816565850047310272290579727564',
        '10484856914279112612610993418405543310546746652738541161791501150994088679557',
        '2026733759645519472558796412979210009170379159866522399881566309631434814953',
        '14731806221235869882801331463708736361296174006732553130708107037190460654379',
        '14740327483193277147065845135561988641238516852487657117813536909482068950652',
        '18787428285295558781869865751953016580493190547148386433580291216673009884554',
        '3804047064713122820157099453648459188816376755739202017447862327783289895072',
        '16709604795697901641948603019242067672006293290826991671766611326262532802914',
        '11061717085931490100602849654034280576915102867237101935487893025907907250695',
        '2821730726367472966906149684046356272806484545281639696873240305052362149654',
        '17467794879902895769410571945152708684493991588672014763135370927880883292655',
        '1571520786233540988201616650622796363168031165456869481368085474420849243232',
        '10041051776251223165849354194892664881051125330236567356945669006147134614302',
        '3981753758468103976812813304477670033098707002886030847251581853700311567551',
        '4365864398105436789177703571412645548020537580493599380018290523813331678900',
        '2391801327305361293476178683853802679507598622000359948432171562543560193350',
        '214219368547551689972421167733597094823289857206402800635962137077096090722',
        '18192064100315141084242006659317257023098826945893371479835220462302399655674',
        '15487549757142039139328911515400805508248576685795694919457041092150651939253',
        '10142447197759703415402259672441315777933858467700579946665223821199077641122',
        '11246573086260753259993971254725613211193686683988426513880826148090811891866',
        '6574066859860991369704567902211886840188702386542112593710271426704432301235',
        '11311085442652291634822798307831431035776248927202286895207125867542470350078',
        '20977948360215259915441258687649465618185769343138135384346964466965010873779',
        '792781492853909872425531014397300057232399608769451037135936617996830018501',
        '5027602491523497423798779154966735896562099398367163998686335127580757861872',
        '14595204575654316237672764823862241845410365278802914304953002937313300553572',
        '13973538843621261113924259058427434053808430378163734641175100160836376897004',
        '16395063164993626722686882727042150241125309409717445381854913964674649318585',
        '8465768840047024550750516678171433288207841931251654898809033371655109266663',
        '21345603324471810861925019445720576814602636473739003852898308205213912255830',
        '21171984405852590343970239018692870799717057961108910523876770029017785940991',
        '10761027113757988230637066281488532903174559953630210849190212601991063767647',
        '6678298831065390834922566306988418588227382406175769592902974103663687992230',
        '4993662582188632374202316265508850988596880036291765531885657575099537176757',
        '18364168158495573675698600238443218434246806358811328083953887470513967121206',
        '3506345610354615013737144848471391553141006285964325596214723571988011984829',
        '248732676202643792226973868626360612151424823368345645514532870586234380100',
        '10090204501612803176317709245679152331057882187411777688746797044706063410969',
        '21297149835078365363970699581821844234354988617890041296044775371855432973500',
        '16729368143229828574342820060716366330476985824952922184463387490091156065099',
        '4467191506765339364971058668792642195242197133011672559453028147641428433293',
        '8677548159358013363291014307402600830078662555833653517843708051504582990832',
        '1022951765127126818581466247360193856197472064872288389992480993218645055345',
        '1888195070251580606973417065636430294417895423429240431595054184472931224452',
        '4221265384902749246920810956363310125115516771964522748896154428740238579824',
        '2825393571154632139467378429077438870179957021959813965940638905853993971879',
        '19171031072692942278056619599721228021635671304612437350119663236604712493093',
        '10780807212297131186617505517708903709488273075252405602261683478333331220733',
        '18230936781133176044598070768084230333433368654744509969087239465125979720995',
        '16901065971871379877929280081392692752968612240624985552337779093292740763381',
        '146494141603558321291767829522948454429758543710648402457451799015963102253',
        '2492729278659146790410698334997955258248120870028541691998279257260289595548',
        '2204224910006646535594933495262085193210692406133533679934843341237521233504',
        '16062117410185840274616925297332331018523844434907012275592638570193234893570',
        '5894928453677122829055071981254202951712129328678534592916926069506935491729',
        '4947482739415078212217504789923078546034438919537985740403824517728200332286',
        '16143265650645676880461646123844627780378251900510645261875867423498913438066',
        '397690828254561723549349897112473766901585444153303054845160673059519614409',
        '11272653598912269895509621181205395118899451234151664604248382803490621227687',
        '15566927854306879444693061574322104423426072650522411176731130806720753591030',
        '14222898219492484180162096141564251903058269177856173968147960855133048449557',
        '16690275395485630428127725067513114066329712673106153451801968992299636791385',
        '3667030990325966886479548860429670833692690972701471494757671819017808678584',
        '21280039024501430842616328642522421302481259067470872421086939673482530783142',
        '15895485136902450169492923978042129726601461603404514670348703312850236146328',
        '7733050956302327984762132317027414325566202380840692458138724610131603812560',
        '438123800976401478772659663183448617575635636575786782566035096946820525816',
        '814913922521637742587885320797606426167962526342166512693085292151314976633',
        '12368712287081330853637674140264759478736012797026621876924395982504369598764',
        '2494806857395134874309386694756263421445039103814920780777601708371037591569',
        '16101132301514338989512946061786320637179843435886825102406248183507106312877',
        '6252650284989960032925831409804233477770646333900692286731621844532438095656',
        '9277135875276787021836189566799935097400042171346561246305113339462708861695',
        '10493603554686607050979497281838644324893776154179810893893660722522945589063',
        '8673089750662709235894359384294076697329948991010184356091130382437645649279',
        '9558393272910366944245875920138649617479779893610128634419086981339060613250',
        '19012287860122586147374214541764572282814469237161122489573881644994964647218',
        '9783723818270121678386992630754842961728702994964214799008457449989291229500',
        '15550788416669474113213749561488122552422887538676036667630838378023479382689',
        '15016165746156232864069722572047169071786333815661109750860165034341572904221',
        '6506225705710197163670556961299945987488979904603689017479840649664564978574',
        '10796631184889302076168355684722130903785890709107732067446714470783437829037',
        '19871836214837460419845806980869387567383718044439891735114283113359312279540',
        '20871081766843466343749609089986071784031203517506781251203251608363835140622',
        '5100105771517691442278432864090229416166996183792075307747582375962855820797',
        '8777887112076272395250620301071581171386440850451972412060638225741125310886',
        '5300440870136391278944213332144327695659161151625757537632832724102670898756',
        '1205448543652932944633962232545707633928124666868453915721030884663332604536',
        '5542499997310181530432302492142574333860449305424174466698068685590909336771',
        '11028094245762332275225364962905938096659249161369092798505554939952525894293',
        '19187314764836593118404597958543112407224947638377479622725713735224279297009',
        '17047263688548829001253658727764731047114098556534482052135734487985276987385',
        '19914849528178967155534624144358541535306360577227460456855821557421213606310',
        '2929658084700714257515872921366736697080475676508114973627124569375444665664',
        '15092262360719700162343163278648422751610766427236295023221516498310468956361',
        '21578580340755653236050830649990190843552802306886938815497471545814130084980',
        '1258781501221760320019859066036073675029057285507345332959539295621677296991',
        '3819598418157732134449049289585680301176983019643974929528867686268702720163',
        '8653175945487997845203439345797943132543211416447757110963967501177317426221',
        '6614652990340435611114076169697104582524566019034036680161902142028967568142',
        '19212515502973904821995111796203064175854996071497099383090983975618035391558',
        '18664315914479294273286016871365663486061896605232511201418576829062292269769',
        '11498264615058604317482574216318586415670903094838791165247179252175768794889',
        '10814026414212439999107945133852431304483604215416531759535467355316227331774',
        '17566185590731088197064706533119299946752127014428399631467913813769853431107',
        '14016139747289624978792446847000951708158212463304817001882956166752906714332',
        '8242601581342441750402731523736202888792436665415852106196418942315563860366',
        '9244680976345080074252591214216060854998619670381671198295645618515047080988',
        '12216779172735125538689875667307129262237123728082657485828359100719208190116',
        '10702811721859145441471328511968332847175733707711670171718794132331147396634',
        '6479667912792222539919362076122453947926362746906450079329453150607427372979',
        '15117544653571553820496948522381772148324367479772362833334593000535648316185',
        '6842203153996907264167856337497139692895299874139131328642472698663046726780',
        '12732823292801537626009139514048596316076834307941224506504666470961250728055',
        '6936272626871035740815028148058841877090860312517423346335878088297448888663',
        '17297554111853491139852678417579991271009602631577069694853813331124433680030',
        '16641596134749940573104316021365063031319260205559553673368334842484345864859',
        '7400481189785154329569470986896455371037813715804007747228648863919991399081',
        '2273205422216987330510475127669563545720586464429614439716564154166712854048',
        '15162538063742142685306302282127534305212832649282186184583465569986719234456',
        '5628039096440332922248578319648483863204530861778160259559031331287721255522',
        '16085392195894691829567913404182676871326863890140775376809129785155092531260',
        '14227467863135365427954093998621993651369686288941275436795622973781503444257',
        '18224457394066545825553407391290108485121649197258948320896164404518684305122',
        '274945154732293792784580363548970818611304339008964723447672490026510689427',
        '11050822248291117548220126630860474473945266276626263036056336623671308219529',
        '2119542016932434047340813757208803962484943912710204325088879681995922344971',
      ]
    );
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('nrounds', [])))
          ? 1
          : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        if (
          bigInt(
            bigInt(bigInt(ctx.getVar('i', [])).eq(bigInt('0')) ? 1 : 0).neq(
              bigInt(0)
            ) ||
              bigInt(
                bigInt(ctx.getVar('i', [])).eq(
                  bigInt(
                    bigInt(ctx.getVar('nrounds', []))
                      .add(__P__)
                      .sub(bigInt('1'))
                      .mod(__P__)
                  )
                )
                  ? 1
                  : 0
              ).neq(bigInt(0))
              ? bigInt(1)
              : bigInt(0)
          ).neq(bigInt(0))
        ) {
          {
            ctx.setVar('c', [], '0');
          }
        } else {
          {
            ctx.setVar(
              'c',
              [],
              ctx.getVar('c_partial', [
                bigInt(ctx.getVar('i', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__),
              ])
            );
          }
        }
        ctx.setVar(
          't',
          [],
          bigInt(bigInt(ctx.getVar('i', [])).eq(bigInt('0')) ? 1 : 0).neq(
            bigInt(0)
          )
            ? bigInt(ctx.getSignal('k', []))
                .add(bigInt(ctx.getSignal('xL_in', [])))
                .mod(__P__)
            : bigInt(
                bigInt(ctx.getSignal('k', []))
                  .add(
                    bigInt(
                      ctx.getSignal('xL', [
                        bigInt(ctx.getVar('i', []))
                          .add(__P__)
                          .sub(bigInt('1'))
                          .mod(__P__),
                      ])
                    )
                  )
                  .mod(__P__)
              )
                .add(bigInt(ctx.getVar('c', [])))
                .mod(__P__)
        );
        yield ctx.setSignal(
          't2',
          [ctx.getVar('i', [])],
          bigInt(ctx.getVar('t', []))
            .mul(bigInt(ctx.getVar('t', [])))
            .mod(__P__)
        );
        yield ctx.setSignal(
          't4',
          [ctx.getVar('i', [])],
          bigInt(ctx.getSignal('t2', [ctx.getVar('i', [])]))
            .mul(bigInt(ctx.getSignal('t2', [ctx.getVar('i', [])])))
            .mod(__P__)
        );
        if (
          bigInt(
            bigInt(ctx.getVar('i', [])).lt(
              bigInt(
                bigInt(ctx.getVar('nrounds', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__)
              )
            )
              ? 1
              : 0
          ).neq(bigInt(0))
        ) {
          {
            yield ctx.setSignal(
              'xL',
              [ctx.getVar('i', [])],
              bigInt(
                bigInt(bigInt(ctx.getVar('i', [])).eq(bigInt('0')) ? 1 : 0).neq(
                  bigInt(0)
                )
                  ? ctx.getSignal('xR_in', [])
                  : ctx.getSignal('xR', [
                      bigInt(ctx.getVar('i', []))
                        .add(__P__)
                        .sub(bigInt('1'))
                        .mod(__P__),
                    ])
              )
                .add(
                  bigInt(
                    bigInt(ctx.getSignal('t4', [ctx.getVar('i', [])]))
                      .mul(bigInt(ctx.getVar('t', [])))
                      .mod(__P__)
                  )
                )
                .mod(__P__)
            );
            yield ctx.setSignal(
              'xR',
              [ctx.getVar('i', [])],
              bigInt(bigInt(ctx.getVar('i', [])).eq(bigInt('0')) ? 1 : 0).neq(
                bigInt(0)
              )
                ? ctx.getSignal('xL_in', [])
                : ctx.getSignal('xL', [
                    bigInt(ctx.getVar('i', []))
                      .add(__P__)
                      .sub(bigInt('1'))
                      .mod(__P__),
                  ])
            );
          }
        } else {
          {
            yield ctx.setSignal(
              'xR_out',
              [],
              bigInt(
                ctx.getSignal('xR', [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ])
              )
                .add(
                  bigInt(
                    bigInt(ctx.getSignal('t4', [ctx.getVar('i', [])]))
                      .mul(bigInt(ctx.getVar('t', [])))
                      .mod(__P__)
                  )
                )
                .mod(__P__)
            );
            yield ctx.setSignal(
              'xL_out',
              [],
              ctx.getSignal('xL', [
                bigInt(ctx.getVar('i', []))
                  .add(__P__)
                  .sub(bigInt('1'))
                  .mod(__P__),
              ])
            );
          }
        }
      }
    }
  },
  HashLeftRight: function* (ctx) {
    yield ctx.setPin('hasher', [], 'ins', ['0'], ctx.getSignal('left', []));
    yield ctx.setPin('hasher', [], 'ins', ['1'], ctx.getSignal('right', []));
    yield ctx.setPin('hasher', [], 'k', [], '0');
    yield ctx.setSignal('hash', [], ctx.getPin('hasher', [], 'outs', ['0']));
  },
  DualMux: function* (ctx) {
    ctx.assert(
      bigInt(ctx.getSignal('s', []))
        .mul(
          bigInt(
            bigInt('1')
              .add(__P__)
              .sub(bigInt(ctx.getSignal('s', [])))
              .mod(__P__)
          )
        )
        .mod(__P__),
      '0',
      '/Users/rstorm/repos/stormdapps/tornado-core/circuits/merkleTree.circom:23:4'
    );
    yield ctx.setSignal(
      'out',
      ['0'],
      bigInt(
        bigInt(
          bigInt(ctx.getSignal('in', ['1']))
            .add(__P__)
            .sub(bigInt(ctx.getSignal('in', ['0'])))
            .mod(__P__)
        )
          .mul(bigInt(ctx.getSignal('s', [])))
          .mod(__P__)
      )
        .add(bigInt(ctx.getSignal('in', ['0'])))
        .mod(__P__)
    );
    yield ctx.setSignal(
      'out',
      ['1'],
      bigInt(
        bigInt(
          bigInt(ctx.getSignal('in', ['0']))
            .add(__P__)
            .sub(bigInt(ctx.getSignal('in', ['1'])))
            .mod(__P__)
        )
          .mul(bigInt(ctx.getSignal('s', [])))
          .mod(__P__)
      )
        .add(bigInt(ctx.getSignal('in', ['1'])))
        .mod(__P__)
    );
  },
  MerkleTreeChecker: function* (ctx) {
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('levels', []))) ? 1 : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setPin(
          'selectors',
          [ctx.getVar('i', [])],
          'in',
          ['0'],
          bigInt(bigInt(ctx.getVar('i', [])).eq(bigInt('0')) ? 1 : 0).neq(
            bigInt(0)
          )
            ? ctx.getSignal('leaf', [])
            : ctx.getPin(
                'hashers',
                [
                  bigInt(ctx.getVar('i', []))
                    .add(__P__)
                    .sub(bigInt('1'))
                    .mod(__P__),
                ],
                'hash',
                []
              )
        );
        yield ctx.setPin(
          'selectors',
          [ctx.getVar('i', [])],
          'in',
          ['1'],
          ctx.getSignal('pathElements', [ctx.getVar('i', [])])
        );
        yield ctx.setPin(
          'selectors',
          [ctx.getVar('i', [])],
          's',
          [],
          ctx.getSignal('pathIndices', [ctx.getVar('i', [])])
        );
        yield ctx.setPin(
          'hashers',
          [ctx.getVar('i', [])],
          'left',
          [],
          ctx.getPin('selectors', [ctx.getVar('i', [])], 'out', ['0'])
        );
        yield ctx.setPin(
          'hashers',
          [ctx.getVar('i', [])],
          'right',
          [],
          ctx.getPin('selectors', [ctx.getVar('i', [])], 'out', ['1'])
        );
      }
    }
    ctx.assert(
      ctx.getSignal('root', []),
      ctx.getPin(
        'hashers',
        [
          bigInt(ctx.getVar('levels', []))
            .add(__P__)
            .sub(bigInt('1'))
            .mod(__P__),
        ],
        'hash',
        []
      ),
      '/Users/rstorm/repos/stormdapps/tornado-core/circuits/merkleTree.circom:50:4'
    );
  },
  CommitmentHasher: function* (ctx) {
    yield ctx.setPin(
      'nullifierBits',
      [],
      'in',
      [],
      ctx.getSignal('nullifier', [])
    );
    yield ctx.setPin('secretBits', [], 'in', [], ctx.getSignal('secret', []));
    for (
      ctx.setVar('i', [], '0');
      bigInt(bigInt(ctx.getVar('i', [])).lt(bigInt('248')) ? 1 : 0).neq(
        bigInt(0)
      );
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setPin(
          'nullifierHasher',
          [],
          'in',
          [ctx.getVar('i', [])],
          ctx.getPin('nullifierBits', [], 'out', [ctx.getVar('i', [])])
        );
        yield ctx.setPin(
          'commitmentHasher',
          [],
          'in',
          [ctx.getVar('i', [])],
          ctx.getPin('nullifierBits', [], 'out', [ctx.getVar('i', [])])
        );
        yield ctx.setPin(
          'commitmentHasher',
          [],
          'in',
          [bigInt(ctx.getVar('i', [])).add(bigInt('248')).mod(__P__)],
          ctx.getPin('secretBits', [], 'out', [ctx.getVar('i', [])])
        );
      }
    }
    yield ctx.setSignal(
      'commitment',
      [],
      ctx.getPin('commitmentHasher', [], 'out', ['0'])
    );
    yield ctx.setSignal(
      'nullifierHash',
      [],
      ctx.getPin('nullifierHasher', [], 'out', ['0'])
    );
  },
  Withdraw: function* (ctx) {
    yield ctx.setPin(
      'hasher',
      [],
      'nullifier',
      [],
      ctx.getSignal('nullifier', [])
    );
    yield ctx.setPin('hasher', [], 'secret', [], ctx.getSignal('secret', []));
    ctx.assert(
      ctx.getPin('hasher', [], 'nullifierHash', []),
      ctx.getSignal('nullifierHash', []),
      '/Users/rstorm/repos/stormdapps/tornado-core/circuits/withdraw.circom:44:4'
    );
    yield ctx.setPin(
      'tree',
      [],
      'leaf',
      [],
      ctx.getPin('hasher', [], 'commitment', [])
    );
    yield ctx.setPin('tree', [], 'root', [], ctx.getSignal('root', []));
    for (
      ctx.setVar('i', [], '0');
      bigInt(
        bigInt(ctx.getVar('i', [])).lt(bigInt(ctx.getVar('levels', []))) ? 1 : 0
      ).neq(bigInt(0));
      ctx
        .setVar(
          'i',
          [],
          bigInt(ctx.getVar('i', [])).add(bigInt('1')).mod(__P__)
        )
        .add(__P__)
        .sub(bigInt(1))
        .mod(__P__)
    ) {
      {
        yield ctx.setPin(
          'tree',
          [],
          'pathElements',
          [ctx.getVar('i', [])],
          ctx.getSignal('pathElements', [ctx.getVar('i', [])])
        );
        yield ctx.setPin(
          'tree',
          [],
          'pathIndices',
          [ctx.getVar('i', [])],
          ctx.getSignal('pathIndices', [ctx.getVar('i', [])])
        );
      }
    }
    yield ctx.setSignal(
      'recipientSquare',
      [],
      bigInt(ctx.getSignal('recipient', []))
        .mul(bigInt(ctx.getSignal('recipient', [])))
        .mod(__P__)
    );
    yield ctx.setSignal(
      'feeSquare',
      [],
      bigInt(ctx.getSignal('fee', []))
        .mul(bigInt(ctx.getSignal('fee', [])))
        .mod(__P__)
    );
    yield ctx.setSignal(
      'relayerSquare',
      [],
      bigInt(ctx.getSignal('relayer', []))
        .mul(bigInt(ctx.getSignal('relayer', [])))
        .mod(__P__)
    );
    yield ctx.setSignal(
      'refundSquare',
      [],
      bigInt(ctx.getSignal('refund', []))
        .mul(bigInt(ctx.getSignal('refund', [])))
        .mod(__P__)
    );
  },
};
const functions = {
  nbits: {
    params: ['a'],
    func: function (ctx) {
      ctx.setVar('n', [], '1');
      ctx.setVar('r', [], '0');
      while (
        bigInt(
          bigInt(
            bigInt(ctx.getVar('n', [])).add(__P__).sub(bigInt('1')).mod(__P__)
          ).lt(bigInt(ctx.getVar('a', [])))
            ? 1
            : 0
        ).neq(bigInt(0))
      ) {
        {
          ctx
            .setVar(
              'r',
              [],
              bigInt(ctx.getVar('r', [])).add(bigInt('1')).mod(__P__)
            )
            .add(__P__)
            .sub(bigInt(1))
            .mod(__P__);
          ctx.setVar(
            'n',
            [],
            bigInt(ctx.getVar('n', [])).mul(bigInt('2')).mod(__P__)
          );
        }
      }
      return ctx.getVar('r', []);
    },
  },
};
module.exports = function (metadata) {
  return Object.assign(unstringifyBigInts(metadata), {
    templates,
    functions,
    getSignalIdx(name) {
      const i = this.signalName2Idx[name];
      if (i !== undefined) return i;
      if (!isNaN(name)) return Number(name);
      throw Error('privacy_proof_invalid_input');
    },
    inputIdx(i) {
      if (i >= this.nInputs) throw Error('privacy_proof_invalid_input');
      return this.nOutputs + 1 + i;
    },
    signalNames(i) {
      return String(i);
    },
    calculateWitness(input) {
      return calculateWitness(this, input, { logFunction: () => undefined });
    },
  });
};
