/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    'playwright',
    'playwright-core',
    '2captcha',
    'docusign-esign',
  ],
};

export default nextConfig;
