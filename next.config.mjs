/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    'playwright',
    'playwright-core',
    '2captcha',
  ],
};

export default nextConfig;
