import {
  getContainerIconStyleAnimation,
  getContainerStyleAnimation,
  getIconStyleAnimation,
} from './getModalStyleAnimation';

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  'preserves container styles for hovered=%s and hidden=%s',
  (hovered, hidden) => {
    const style = {
      width: hovered ? '100vw' : '2.75rem',
      height: hovered ? 'auto' : '2.75rem',
      minHeight: hovered ? '64px' : '2.75rem',
      borderTopRightRadius: hovered ? '20px' : '999px',
      borderTopLeftRadius: hovered ? '20px' : 'unset',
      opacity: hidden ? 0 : 1,
    };
    expect(getContainerStyleAnimation(hovered, hidden)).toEqual({
      style,
      animation: { ...style, transition: { duration: 0.3, ease: 'easeInOut' } },
    });
  }
);

it.each([false, true])(
  'preserves icon-container styles for hovered=%s',
  (hovered) => {
    const shared = {
      backgroundColor: hovered ? '#476DAA' : '#4d76b8',
      borderTopRightRadius: hovered ? 'unset' : '999px',
      borderTopLeftRadius: hovered ? '20px' : 'unset',
    };
    const result = getContainerIconStyleAnimation(hovered);
    expect(result).toEqual({
      style: { width: hovered ? '55px' : '2.75rem', ...shared },
      animation: {
        ...shared,
        transition: { duration: 0.3, ease: 'easeInOut' },
      },
    });
    // Width has always been static style only, not an animation target.
    expect(result.animation).not.toHaveProperty('width');
  }
);

it.each([false, true])('preserves glyph styles for hovered=%s', (hovered) => {
  const expected = {
    position: 'absolute',
    left: hovered ? '15px' : '5px',
    bottom: hovered ? '18px' : '6px',
  };
  expect(getIconStyleAnimation(hovered)).toEqual({
    style: expected,
    animation: expected,
  });
});

it.each([
  ['container', () => getContainerStyleAnimation(true, false)],
  ['icon container', () => getContainerIconStyleAnimation(true)],
  ['glyph', () => getIconStyleAnimation(true)],
] as const)(
  'keeps %s objects independent within and across calls',
  (_label, factory) => {
    const first = factory() as {
      animation: Record<string, any>;
      style: Record<string, any>;
    };
    const second = factory() as typeof first;
    const original = JSON.parse(JSON.stringify(second));
    expect(first).not.toBe(second);
    expect(first.style).not.toBe(first.animation);
    expect(first.style).not.toBe(second.style);
    expect(first.animation).not.toBe(second.animation);
    const key = Object.keys(first.style)[0];
    (first.style as any)[key] = 'changed style';
    expect(first.animation).toEqual(original.animation);
    (first.animation as any)[key] = 'changed animation';
    if ('transition' in first.animation) {
      expect((first.animation as any).transition).not.toBe(
        (second.animation as any).transition
      );
      (first.animation as any).transition.duration = 99;
    }
    expect(second).toEqual(original);
    expect(factory()).toEqual(original);
  }
);
