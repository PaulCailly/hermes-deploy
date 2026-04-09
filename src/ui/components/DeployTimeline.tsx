import React from 'react';
import { Box, Text } from 'ink';
import { PhaseRow, type PhaseStatus } from './PhaseRow.js';

export interface TimelinePhase {
  id: string;
  label: string;
  status: PhaseStatus;
  error?: string;
}

export interface DeployTimelineProps {
  phases: TimelinePhase[];
  logLines: string[];
  finalMessage?: string;
  finalStatus?: 'success' | 'failure';
}

/**
 * Renders a deploy/update timeline as a vertical list of phase rows
 * (with spinner on the active row, checkmark on completed rows, and
 * red X on failed rows), plus the last 10 log lines from the active
 * rebuild stream, plus a final success/failure summary line at the end.
 *
 * Pure presentational component — the InkReporter mutates state and
 * calls instance.rerender() with the updated props.
 */
export function DeployTimeline({
  phases,
  logLines,
  finalMessage,
  finalStatus,
}: DeployTimelineProps) {
  const recentLogs = logLines.slice(-10);
  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {phases.map(p => (
          <PhaseRow key={p.id} label={p.label} status={p.status} error={p.error} />
        ))}
      </Box>
      {recentLogs.length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingLeft={4}>
          {recentLogs.map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      )}
      {finalMessage && (
        <Box marginTop={1}>
          <Text color={finalStatus === 'success' ? 'green' : 'red'} bold>
            {finalMessage}
          </Text>
        </Box>
      )}
    </Box>
  );
}
