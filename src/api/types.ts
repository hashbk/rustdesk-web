export interface ServerConfigResponse {
  rendezvous_host: string;
  relay_host?: string;
  key: string;
  use_wss: boolean;
}

export interface AddressBookPeer {
  id: string;
  alias?: string;
  hash?: string;
  password?: string;
  note?: string;
  tags?: string[];
  username?: string;
  hostname?: string;
  platform?: string;
}

export interface PeersResponse {
  peers: AddressBookPeer[];
  total?: number;
}

export interface CurrentUserResponse {
  id: string | number;
  name?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}