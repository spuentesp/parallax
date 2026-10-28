import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from './Theme.js';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

describe('ThemeToggle', () => {
  it('starts dark, offers light, and flips the document class and its own label', () => {
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    const toLight = screen.getByRole('button', { name: 'Switch to light mode' });
    expect(toLight.textContent).toContain('Light');
    fireEvent.click(toLight);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    const toDark = screen.getByRole('button', { name: 'Switch to dark mode' });
    expect(toDark.textContent).toContain('Dark');
    fireEvent.click(toDark);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
