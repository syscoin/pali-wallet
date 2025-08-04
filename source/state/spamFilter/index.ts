import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { ISpamFilterState } from 'types/security';

const DEFAULT_CONFIG = {
  requestThreshold: 3,
  timeWindowMs: 10000, // 10 seconds
  blockDurationMs: 60000, // 1 minute
  enabled: true,
};

const initialState: ISpamFilterState = {
  dapps: {},
  config: DEFAULT_CONFIG,
};

const spamFilterSlice = createSlice({
  name: 'spamFilter',
  initialState,
  reducers: {
    recordRequest: (
      state,
      action: PayloadAction<{ host: string; method: string }>
    ) => {
      const { host, method } = action.payload;
      const now = Date.now();

      if (!state.dapps[host]) {
        state.dapps[host] = {
          host,
          requests: [],
          warningShown: false,
          lastResetTime: now,
        };
      }

      const dappState = state.dapps[host];

      // Clean old requests outside the time window
      const cutoffTime = now - state.config.timeWindowMs;
      dappState.requests = dappState.requests.filter(
        (req) => req.timestamp > cutoffTime
      );

      // Add new request
      dappState.requests.push({ timestamp: now, method });
    },

    showWarning: (state, action: PayloadAction<{ host: string }>) => {
      const { host } = action.payload;
      if (state.dapps[host]) {
        state.dapps[host].warningShown = true;
      }
    },

    blockDapp: (state, action: PayloadAction<{ host: string }>) => {
      const { host } = action.payload;
      const now = Date.now();

      if (!state.dapps[host]) {
        state.dapps[host] = {
          host,
          requests: [],
          warningShown: false,
          lastResetTime: now,
        };
      }

      state.dapps[host].blockedUntil = now + state.config.blockDurationMs;
      state.dapps[host].requests = [];
      state.dapps[host].warningShown = false;
    },

    unblockDapp: (state, action: PayloadAction<{ host: string }>) => {
      const { host } = action.payload;
      if (state.dapps[host]) {
        delete state.dapps[host].blockedUntil;
      }
    },

    clearDappState: (state, action: PayloadAction<{ host: string }>) => {
      const { host } = action.payload;
      delete state.dapps[host];
    },

    resetDappRequests: (state, action: PayloadAction<{ host: string }>) => {
      const { host } = action.payload;
      if (state.dapps[host]) {
        state.dapps[host].requests = [];
        state.dapps[host].warningShown = false;
      }
    },

    resetSpamFilter: (state) => {
      state.dapps = {};
    },

    updateConfig: (
      state,
      action: PayloadAction<Partial<ISpamFilterState['config']>>
    ) => {
      state.config = { ...state.config, ...action.payload };
    },
  },
});

export const {
  recordRequest,
  showWarning,
  blockDapp,
  unblockDapp,
  clearDappState,
  resetDappRequests,
  resetSpamFilter,
  updateConfig,
} = spamFilterSlice.actions;

export default spamFilterSlice.reducer;
