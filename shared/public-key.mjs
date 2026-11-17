// API-key classification only. NEVER use a decoded JWT to authenticate a user.
// Supabase still validates the API key; /auth/v1/user verifies the user's token.
export function isPublicApiKey(value) {
  if(typeof value!=='string')return false;
  if(/^sb_publishable_[A-Za-z0-9_-]+$/.test(value))return true;
  const parts=value.split('.');
  if(parts.length!==3||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))return false;
  try {
    const encoded=parts[1].replace(/-/g,'+').replace(/_/g,'/');
    const payload=JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));
    return payload.role==='anon';
  }catch{return false;}
}
