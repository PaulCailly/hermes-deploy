import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export type PhaseStatus = 'pending' | 'running' | 'done' | 'failed';

export interface PhaseRowProps {
  label: string;
  status: PhaseStatus;
  error?: string;
}

const STATUS_CHAR: Record<PhaseStatus, string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  failed: '✗',
};

const STATUS_COLOR: Record<PhaseStatus, string> = {
  pending: 'gray',
  running: 'cyan',
  done: 'green',
  failed: 'red',
};

export function PhaseRow({ label, status, error }: PhaseRowProps) {
  return (
    <Box>
      <Text color={STATUS_COLOR[status]}>
        {status === 'running' ? <Spinner type="dots" /> : STATUS_CHAR[status]}
      </Text>
      <Text> {label}</Text>
      {error && <Text color="red"> — {error}</Text>}
    </Box>
  );
}
