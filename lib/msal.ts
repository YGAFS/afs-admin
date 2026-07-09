import { PublicClientApplication, type Configuration } from '@azure/msal-browser'

const msalConfig: Configuration = {
  auth: {
    clientId:   process.env.NEXT_PUBLIC_AZURE_CLIENT_ID ?? '',
    authority:  `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID}`,
    redirectUri: typeof window !== 'undefined' ? window.location.origin : '',
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
}

let _msal: PublicClientApplication | null = null

export async function getMsal(): Promise<PublicClientApplication> {
  if (!_msal) {
    _msal = new PublicClientApplication(msalConfig)
    await _msal.initialize()
  }
  return _msal
}

export const MAIL_SCOPES = ['https://graph.microsoft.com/Mail.Send']
