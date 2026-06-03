import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Callout } from './Callout';
import { Txt } from './Txt';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Short label for which surface failed (shown in the report + logged). */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Catches a render/lifecycle exception in its subtree so one broken screen shows an
 * inline, copyable crash report instead of taking down the whole app. The error +
 * stack + React component stack render as selectable mono text — paste them to
 * diagnose. (React error boundaries must be class components; the themed report is a
 * function child so it can use {@link useTheme}.)
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    // eslint-disable-next-line no-console -- surface the stack to the dev console too
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <CrashReport error={this.state.error} componentStack={this.state.componentStack} label={this.props.label} />;
  }
}

function CrashReport({ error, componentStack, label }: { error: Error; componentStack: string | null; label?: string }) {
  const { colors } = useTheme();
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.report}>
      <Callout tone="danger" iconName="alert" title={label ? `${label} crashed` : 'This screen crashed'}>
        Copy the details below so the crash can be fixed.
      </Callout>
      <Txt variant="footnote" weight="bold" mono tone="danger" selectable>
        {error.name}: {error.message}
      </Txt>
      {error.stack ? (
        <Txt variant="caption" mono tone="inkMuted" selectable style={[styles.stack, { borderColor: colors.lineFaint, backgroundColor: colors.codeBg }]}>
          {error.stack}
        </Txt>
      ) : null}
      {componentStack ? (
        <Txt variant="caption" mono tone="inkFaint" selectable style={[styles.stack, { borderColor: colors.lineFaint, backgroundColor: colors.codeBg }]}>
          {componentStack}
        </Txt>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  report: { gap: spacing.md, paddingVertical: spacing.md },
  stack: { padding: spacing.sm, borderRadius: radii.md, borderWidth: 1 },
});
