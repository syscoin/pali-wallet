/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import { LogoHeader } from './LogoHeader';

jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: useNavigate() }),
}));
jest.mock('components/index', () => ({
  IconButton: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
  Icon: () => <span>Home</span>,
}));

it.each([['/create-password'], ['/settings/account/private-key', '/phrase']])(
  'returns onboarding to its landing page regardless of prior history: %j',
  (...entries) => {
    render(
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route path="/" element={<p>Wallet landing</p>} />
          <Route
            path="/settings/account/private-key"
            element={<p>Secret view</p>}
          />
          <Route path="*" element={<LogoHeader />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));

    expect(screen.getByText('Wallet landing')).toBeTruthy();
    expect(screen.queryByText('Secret view')).toBeNull();
  }
);
