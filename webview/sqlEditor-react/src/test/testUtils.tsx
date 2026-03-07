import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { VSCodeProvider } from '../context/VSCodeContext';

// Custom render that wraps with providers
function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  function AllProviders({ children }: { children: React.ReactNode }) {
    return <VSCodeProvider>{children}</VSCodeProvider>;
  }

  return render(ui, { wrapper: AllProviders, ...options });
}

// Re-export everything from testing-library
export * from '@testing-library/react';
export { customRender as render };
