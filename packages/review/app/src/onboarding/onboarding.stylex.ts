import * as stylex from "@stylexjs/stylex";

// First run's display type sits far above the canvas's display step: each
// screen carries one sentence, set large.
export const onboardingType = stylex.defineConsts({
  hero: "56px",
  heroLeading: "62px",
  title: "64px",
  titleLeading: "68px",
  // A working screen's title, above the content it introduces.
  heading: "40px",
  headingLeading: "46px",
  lead: "19px",
  leadLeading: "29px",
});

export const onboardingTracking = stylex.defineConsts({
  display: "-0.025em",
});

export const onboardingMotion = stylex.defineConsts({
  // One screen giving way to the next.
  screen: "420ms",
  // Each line of a screen after the one above it.
  stagger: "60ms",
  spin: "900ms",
  enter: "cubic-bezier(0.2, 0.7, 0.2, 1)",
});
