import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeScreen } from '../../src/components/WelcomeScreen';

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: () => ({
    openRepositoryPicker: vi.fn(),
    repos: [],
    metadata: {},
    openRepository: vi.fn(),
  }),
}));

describe('WelcomeScreen', () => {
  it('renders app title', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('PrismGit')).toBeInTheDocument();
  });

  it('renders description', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText(/modern, cross-platform Git client/i)).toBeInTheDocument();
  });

  it('renders Open Repository button', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('Open Repository')).toBeInTheDocument();
  });

  it('renders Clone Repository button', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('Clone Repository')).toBeInTheDocument();
  });

  it('renders New Repository button', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('New Repository')).toBeInTheDocument();
  });

  it('shows drag-and-drop hint', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText(/Drag folders onto this window/i)).toBeInTheDocument();
  });
});
