/**
 * sshCredentials.js
 * Loads SSH credentials from .env for each known appliance.
 * Never exposed to frontend.
 */

export function getCredentials(ip) {
  const suffix = ip.split('.').pop(); // last octet e.g. 201

  const user = process.env[`SSH_USER_${suffix}`] || process.env.SSH_DEFAULT_USER || 'root';
  const pass = process.env[`SSH_PASS_${suffix}`] || process.env.SSH_DEFAULT_PASS || '';
  const sudoPass = process.env[`SSH_PASS_${suffix}_SUDO`] || pass;

  return { host: ip, port: 22, username: user, password: pass, sudoPass };
}

export function getAllCredentials() {
  return {
    '192.168.10.201': getCredentials('192.168.10.201'),
    '192.168.10.203': getCredentials('192.168.10.203'),
    '192.168.10.196': getCredentials('192.168.10.196'),
    '192.168.10.165': getCredentials('192.168.10.165'),
  };
}
