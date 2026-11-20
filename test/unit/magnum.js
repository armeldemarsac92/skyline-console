// SPDX-License-Identifier: Apache-2.0
import axios from 'axios';

// Keep Skyline's HTTP client, JSON encoding, headers and interceptors in the test.
export function mockMagnum(handle) {
  const previous = axios.defaults.adapter;
  const requests = [];
  axios.defaults.adapter = async (config) => {
    const url = new URL(config.url, 'http://skyline.test');
    const index = url.pathname.search(/\/v1(?:\/|$)/);
    const request = {
      method: config.method.toUpperCase(),
      path: index < 0 ? '/' : url.pathname.slice(index),
      url: url.pathname,
      params: config.params || {},
      headers: config.headers,
      body:
        typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
    };
    requests.push(request);
    const result = await handle(request);
    if (!result)
      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    const response = { status: 200, headers: {}, ...result, config };
    if (response.status >= 400) {
      throw Object.assign(new Error(`Magnum HTTP ${response.status}`), {
        response,
      });
    }
    return response;
  };
  return {
    requests,
    restore: () => {
      axios.defaults.adapter = previous;
    },
  };
}
