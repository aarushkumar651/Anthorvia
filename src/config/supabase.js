const { createClient } = require('@supabase/supabase-js');
const { config } = require('./env');

let serviceClient;
let anonClient;

function getServiceClient() {
  if (!serviceClient) {
    serviceClient = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return serviceClient;
}

function getAnonClient() {
  if (!anonClient) {
    anonClient = createClient(config.supabase.url, config.supabase.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false,
      },
    });
  }
  return anonClient;
}

module.exports = { getServiceClient, getAnonClient };
