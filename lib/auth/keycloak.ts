// Keycloak singleton — browser only, never import on server
import Keycloak from "keycloak-js";

let _keycloak: Keycloak | null = null;

export function getKeycloak(): Keycloak {
  if (!_keycloak) {
    _keycloak = new Keycloak({
      url: process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8080",
      realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? "nest-realm",
      clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "nest-api",
    });
  }
  return _keycloak;
}
