import { StyleSheet } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';

/**
 * The accessibility floor, checked mechanically (docs/design/ACCESSIBILITY.md, PLAT-2). It renders nothing itself: given a rendered tree it
 * lists every pressable control that fails the floor, so a screen cannot regress quietly.
 *
 * Checked per control: a role; a label that names the ACTION (present, and not just an icon name); and a touch target of at least 44 points
 * that is STATED (a height or minHeight, or a hit slop that makes up the difference), because a target nobody wrote down cannot be verified.
 * Not checkable here, and so done by hand on a device: screen-reader order, contrast on the real colours, 200% text and RTL (see the spec).
 */
export const MIN_TARGET = 44;

export interface Violation { readonly label: string; readonly problem: string }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * One entry per control. A styled component renders several nested components that share one handler; the OUTER one carries the role and
 * label, and the INNER one carries the resolved style. Both are read, and the merged result is what a screen reader and a finger would meet.
 */
export function pressables(tree: ReactTestRenderer) {
  const groups = new Map<unknown, any[]>();
  // Only what is actually drawn is a control: a component that renders nothing (a strip with nothing to show) has no target to miss.
  const drawn = (n: { findAll: (f: (c: any) => boolean) => unknown[] }) => n.findAll(c => typeof c.type === 'string').length > 0;
  for (const n of tree.root.findAll(n => typeof n.props.onPress === 'function' && typeof n.type !== 'string' && drawn(n))) {
    groups.set(n.props.onPress, [...(groups.get(n.props.onPress) ?? []), n]);
  }
  return [...groups.values()].map(nodes => {
    const styled = nodes.map(n => StyleSheet.flatten(n.props.style) ?? {}).reduce((acc, st) => ({ ...acc, ...st }), {});
    const props = nodes.reduce((acc, n) => ({ ...acc, ...Object.fromEntries(Object.entries(n.props).filter(([, v]) => v !== undefined)) }), {} as any);
    return { props: { ...props, style: styled } };
  });
}

export function auditPressables(tree: ReactTestRenderer, ignoreLabels: RegExp[] = []): Violation[] {
  const out: Violation[] = [];
  for (const n of pressables(tree)) {
    const label = typeof n.props.accessibilityLabel === 'string' ? n.props.accessibilityLabel : '';
    const name = label || '(no label)';
    if (ignoreLabels.some(r => r.test(label))) continue;
    if (!n.props.accessibilityRole) out.push({ label: name, problem: 'no accessibilityRole' });
    if (!label.trim()) out.push({ label: name, problem: 'no accessibilityLabel' });
    else if (label.trim().split(/\s+/).length < 2 && !/^(close|back|retry|cancel)$/i.test(label.trim())) out.push({ label: name, problem: 'label is a single word: name the action' });
    const style = StyleSheet.flatten(n.props.style) ?? {};
    const slop = n.props.hitSlop;
    const slopV = typeof slop === 'number' ? slop * 2 : (num(slop?.top) ?? 0) + (num(slop?.bottom) ?? 0);
    const slopH = typeof slop === 'number' ? slop * 2 : (num(slop?.left) ?? 0) + (num(slop?.right) ?? 0);
    const h = Math.max(num((style as any).height) ?? 0, num((style as any).minHeight) ?? 0) + slopV;
    const w = Math.max(num((style as any).width) ?? 0, num((style as any).minWidth) ?? 0) + slopH;
    const widthPct = typeof (style as any).width === 'string'; // a percentage fills its row: wide enough
    if (h < MIN_TARGET) out.push({ label: name, problem: `height ${h || 'not stated'} < ${MIN_TARGET}` });
    if (!widthPct && w > 0 && w < MIN_TARGET) out.push({ label: name, problem: `width ${w} < ${MIN_TARGET}` });
  }
  return out;
}
