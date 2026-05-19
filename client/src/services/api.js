import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 600000, // 10 minutes for long-running requests (audio/image generation)
  headers: {
    'Content-Type': 'application/json'
  }
});

export default api;
