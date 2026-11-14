import axios from 'axios';
import { API_URL } from './config';

const api = axios.create({ baseURL: API_URL, timeout: 10000 });
let token = null;

export const setToken = (t) => { token = t; };
export const getToken = () => token; // weighing.js / batchWeightImage.js use this for the ?token= image URLs

api.interceptors.request.use((cfg) => {
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

export const errMsg = (e) =>
  e.response?.data?.message ||
  (e.request ? 'Unable to connect to the server. Please check your WiFi / IP address.' : e.message);

export default api;