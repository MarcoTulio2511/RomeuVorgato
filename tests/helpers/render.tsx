import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from 'styled-components';
import { ToastProvider } from '../../src/components/feedback/Toast';
import { theme } from '../../src/styles/theme';

export function renderUi(ui: ReactElement, route = '/') {
  return render(
    <ThemeProvider theme={theme}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}
