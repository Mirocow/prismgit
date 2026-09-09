import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeScreen } from '../../src/components/WelcomeScreen';

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: () => ({
    openRepositoryPicker: vi.fn(),
  }),
}));

describe('WelcomeScreen', () => {
  it('renders app title', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('SmartGit Electron')).toBeInTheDocument();
  });

  it('renders description', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText(/modern, cross-platform Git client/i)).toBeInTheDocument();
  });

  it('renders Open Repository button', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('Open Repository')).toBeInTheDocument();
  });

  it('renders Clone from GitHub button', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('Clone from GitHub')).toBeInTheDocument();
  });

  it('shows keyboard shortcuts hint', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText(/Ctrl\+O to open/i)).toBeInTheDocument();
  });
});
