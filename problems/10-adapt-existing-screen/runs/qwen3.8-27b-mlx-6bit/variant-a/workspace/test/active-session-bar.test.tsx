import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ActiveSession, UseActiveSessionResult } from '../src/features/sessions/use-active-session';

const { mockUseActiveSession, mockUseNavigate } = vi.hoisted(() => ({
  mockUseActiveSession: vi.fn(),
  mockUseNavigate: vi.fn(),
}));

vi.mock('../src/features/sessions/use-active-session', () => ({
  useActiveSession: mockUseActiveSession,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: mockUseNavigate,
}));

import { ActiveSessionBar } from '../src/features/sessions/active-session-bar';

function makeActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 'sess-1',
    name: 'Test Session',
    status: 'open',
    startedAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function makeHookResult(overrides: Partial<UseActiveSessionResult> = {}): UseActiveSessionResult {
  return {
    active: null,
    isFetching: false,
    setActive: vi.fn().mockResolvedValue(undefined),
    closeActive: vi.fn().mockResolvedValue(undefined),
    isMutating: false,
    ...overrides,
  };
}

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseNavigate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing when no active session', () => {
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: null }));
    const { container } = render(<ActiveSessionBar />);

    expect(container.innerHTML).toBe('');
  });

  it('renders session name, status badge, and a non-zero elapsed string when an active session exists', () => {
    vi.setSystemTime(new Date('2024-01-15T10:00:05.000Z').getTime());
    const session = makeActiveSession({ startedAt: '2024-01-15T10:00:00.000Z' });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));

    render(<ActiveSessionBar />);

    expect(screen.getByTestId('active-session-name').textContent).toBe('Test Session');
    expect(screen.getByTestId('active-session-status').textContent).toBe('open');
    const elapsed = screen.getByTestId('active-session-elapsed').textContent;
    expect(elapsed).not.toBe('0s');
  });

  it('elapsed time ticks forward after two intervals', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime + 5000);
    const session = makeActiveSession({ startedAt: '2024-01-15T10:00:00.000Z' });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));

    render(<ActiveSessionBar />);
    const initialElapsed = screen.getByTestId('active-session-elapsed').textContent;

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const laterElapsed = screen.getByTestId('active-session-elapsed').textContent;
    expect(laterElapsed).not.toBe(initialElapsed);
  });

  it('formats elapsed correctly at second, minute, and hour thresholds', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    // 59 seconds → "59s"
    {
      const session = makeActiveSession({ startedAt: new Date(baseTime - 59_000).toISOString() });
      mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
      const { unmount } = render(<ActiveSessionBar />);
      expect(screen.getByTestId('active-session-elapsed').textContent).toBe('59s');
      unmount();
    }

    // 61 seconds → "1m 1s"
    {
      const session = makeActiveSession({ startedAt: new Date(baseTime - 61_000).toISOString() });
      mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
      const { unmount } = render(<ActiveSessionBar />);
      expect(screen.getByTestId('active-session-elapsed').textContent).toBe('1m 1s');
      unmount();
    }

    // 3601 seconds → "1h 0m 1s"
    {
      const session = makeActiveSession({ startedAt: new Date(baseTime - 3_601_000).toISOString() });
      mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
      const { unmount } = render(<ActiveSessionBar />);
      expect(screen.getByTestId('active-session-elapsed').textContent).toBe('1h 0m 1s');
      unmount();
    }
  });

  it('clears interval when active session changes to a different id', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    const sessionA = makeActiveSession({ id: 'a', startedAt: new Date(baseTime - 10_000).toISOString() });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: sessionA }));
    const { rerender } = render(<ActiveSessionBar />);

    expect(vi.getTimerCount()).toBe(1);

    const sessionB = makeActiveSession({ id: 'b', startedAt: new Date(baseTime - 20_000).toISOString() });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: sessionB }));
    rerender(<ActiveSessionBar />);

    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Session B started 20 s ago; after one more tick the elapsed is 21 s.
    expect(screen.getByTestId('active-session-elapsed').textContent).toBe('21s');
  });

  it('clears interval when active transitions to null', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    const session = makeActiveSession({ startedAt: new Date(baseTime - 5_000).toISOString() });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
    const { rerender } = render(<ActiveSessionBar />);

    expect(vi.getTimerCount()).toBe(1);

    mockUseActiveSession.mockReturnValue(makeHookResult({ active: null }));
    rerender(<ActiveSessionBar />);

    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByTestId('active-session-bar')).toBeNull();
  });

  it('navigates to /sessions/<active.id> on Resume click', () => {
    const session = makeActiveSession({ id: 'sess-42' });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
    render(<ActiveSessionBar />);

    screen.getByText('Resume').click();

    expect(mockUseNavigate).toHaveBeenCalledWith('/sessions/sess-42');
  });

  it('does not navigate on Resume click when active is null', () => {
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: null }));
    render(<ActiveSessionBar />);

    expect(mockUseNavigate).not.toHaveBeenCalled();
  });

  it('calls closeActive when window.confirm returns true', () => {
    const session = makeActiveSession();
    const closeActive = vi.fn().mockResolvedValue(undefined);
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session, closeActive }));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ActiveSessionBar />);

    screen.getByText('Close session').click();

    expect(confirmSpy).toHaveBeenCalledWith('Close this session?');
    expect(closeActive).toHaveBeenCalledTimes(1);
  });

  it('does not call closeActive when window.confirm returns false', () => {
    const session = makeActiveSession();
    const closeActive = vi.fn().mockResolvedValue(undefined);
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session, closeActive }));

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ActiveSessionBar />);

    screen.getByText('Close session').click();

    expect(closeActive).not.toHaveBeenCalled();
  });

  it('disables both buttons while isMutating is true', () => {
    const session = makeActiveSession();
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session, isMutating: true }));
    render(<ActiveSessionBar />);

    expect(screen.getByText('Resume')).toBeDisabled();
    expect(screen.getByText('Close session')).toBeDisabled();
  });

  it('does not create a second interval on re-mount with the same session', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    const session = makeActiveSession({ startedAt: new Date(baseTime - 5_000).toISOString() });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));

    const { unmount } = render(<ActiveSessionBar />);
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    render(<ActiveSessionBar />);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not crash or display NaN when startedAt is an invalid ISO string', () => {
    const session = makeActiveSession({ startedAt: 'not-a-valid-date' });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));

    render(<ActiveSessionBar />);

    const elapsed = screen.getByTestId('active-session-elapsed').textContent;
    expect(elapsed).not.toContain('NaN');
  });
});
