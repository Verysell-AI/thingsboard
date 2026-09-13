import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from '~/components/shell/sidebar';

function renderSidebar(collapsed: boolean, onToggleCollapsed = vi.fn()) {
  return render(
    <MemoryRouter>
      <Sidebar
        showConsole
        role="TENANT_ADMIN"
        open={false}
        onClose={() => {}}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('keeps every link label readable by assistive tech when collapsed to an icon rail', () => {
    const { container } = renderSidebar(true);
    expect(container.querySelector('aside')?.dataset.collapsed).toBe('true');
    const labels = [...container.querySelectorAll('nav a span')];
    expect(labels.length).toBeGreaterThan(5);
    for (const label of labels) {
      expect(label.className).toContain('md:sr-only');
      expect(label.textContent).not.toBe('');
    }
    for (const link of container.querySelectorAll('nav a')) {
      expect(link.getAttribute('title')).toBe(link.textContent);
    }
  });

  it('shows full labels when expanded and toggles through the rail button', () => {
    const onToggle = vi.fn();
    const { container, getByRole } = renderSidebar(false, onToggle);
    expect(container.querySelector('aside')?.dataset.collapsed).toBeUndefined();
    for (const label of container.querySelectorAll('nav a span')) {
      expect(label.className).not.toContain('sr-only');
    }
    const toggle = getByRole('button', { name: 'app.collapseMenu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
