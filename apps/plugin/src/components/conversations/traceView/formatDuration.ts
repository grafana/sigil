// Ported from Grafana's TraceView (Apache 2.0)
// Duration values are in microseconds.

const ONE_MILLISECOND = 1000;
const ONE_SECOND = 1000 * ONE_MILLISECOND;
const ONE_MINUTE = 60 * ONE_SECOND;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

const UNIT_STEPS: Array<{ unit: string; microseconds: number; ofPrevious: number }> = [
  { unit: 'd', microseconds: ONE_DAY, ofPrevious: 24 },
  { unit: 'h', microseconds: ONE_HOUR, ofPrevious: 60 },
  { unit: 'm', microseconds: ONE_MINUTE, ofPrevious: 60 },
  { unit: 's', microseconds: ONE_SECOND, ofPrevious: 1000 },
  { unit: 'ms', microseconds: ONE_MILLISECOND, ofPrevious: 1000 },
  { unit: 'μs', microseconds: 1, ofPrevious: 1000 },
];

function round(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

export function formatDuration(duration: number): string {
  let primaryIdx = UNIT_STEPS.length - 1;
  for (let i = 0; i < UNIT_STEPS.length - 1; i++) {
    if (UNIT_STEPS[i].microseconds <= duration) {
      primaryIdx = i;
      break;
    }
  }

  const primaryUnit = UNIT_STEPS[primaryIdx];
  const secondaryUnit = UNIT_STEPS[Math.min(primaryIdx + 1, UNIT_STEPS.length - 1)];

  if (primaryUnit.ofPrevious === 1000) {
    return `${round(duration / primaryUnit.microseconds, 2)}${primaryUnit.unit}`;
  }

  let primaryValue = Math.floor(duration / primaryUnit.microseconds);
  let secondaryValue = (duration / secondaryUnit.microseconds) % primaryUnit.ofPrevious;
  const secondaryValueRounded = Math.round(secondaryValue);

  if (secondaryValueRounded === primaryUnit.ofPrevious) {
    primaryValue += 1;
    secondaryValue = 0;
  } else {
    secondaryValue = secondaryValueRounded;
  }

  const primaryUnitString = `${primaryValue}${primaryUnit.unit}`;

  if (secondaryValue === 0) {
    return primaryUnitString;
  }

  const secondaryUnitString = `${secondaryValue}${secondaryUnit.unit}`;
  return `${primaryUnitString} ${secondaryUnitString}`;
}
