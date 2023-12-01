


/// import

import { Buffer } from "buffer";
import { BaseDirectory, readTextFile } from "@tauri-apps/api/fs";
import { parse as toml } from "smol-toml";
import { sep as separator } from "@tauri-apps/api/path";
import * as x509 from "@peculiar/x509";

/// util

import { default as bns } from "./bns";
import type { ConfigFile } from "./interface";

interface AuthNSOptions {
  domain: string;
  host: string;
  kskkey: string;
  kskpriv: string;
  test?: boolean;
  zskkey: string;
  zskpriv: string;
}

/// variable

const { AuthServer, constants, dnssec, tlsa } = bns;
const { types } = constants;
const KSK = 1 << 0;
const ZONE = 1 << 8;



/// export

export class AuthNS {
  private domain: string;
  private host: string;
  private kskkey: string;
  private kskpriv: string;
  private name: string;
  private port: number;
  public server: typeof AuthServer;
  private zskkey: string;
  private zskpriv: string;

  constructor(options: AuthNSOptions) {
    this.domain = `${options.domain}.`;
    this.host = options.host;
    this.kskkey = options.kskkey;
    this.kskpriv = options.kskpriv;
    this.name = this.domain.slice(0, -1);
    this.port = options.test ? 53530 : 53;
    this.server = new AuthServer({
      dnssec: true,
      edns: true,
      tcp: true
    });
    this.zskkey = options.zskkey;
    this.zskpriv = options.zskpriv;
  }

  async init(): Promise<void> {
    this.server.setOrigin(this.domain);
    const zone = this.server.zone;

    // Create SOA
    zone.fromString(
      `${this.domain} 21600 IN SOA ns.${this.domain} email.${this.domain} ` +
      parseInt(String(Date.now() / 1000)) +
      " 86400 7200 604800 300"
    );

    // Create self-referencing NS and glue
    zone.fromString(`${this.domain} 21600 IN NS ns.${this.domain}`);
    zone.fromString(`ns.${this.domain} 21600 IN A ${this.host}`);

    // Create A records for TLD and all domains
    zone.fromString(`${this.domain} 21600 IN A ${this.host}`);
    zone.fromString(`*.${this.domain} 21600 IN A ${this.host}`);

    // Create TLSA from certificate
    const certificateFile = ["Dolo", this.name, "tls", `${this.name}.crt`].join(separator);
    const certificateFileContent = await readTextFile(certificateFile, { dir: BaseDirectory.Document });
    const cert = new x509.X509Certificate(certificateFileContent);
    const tlsarr = tlsa.create(new Buffer(cert.rawData), this.domain, "tcp", 443);

    zone.insert(tlsarr);

    // Wildcard the TLSA for subdomains
    const tlsaWild = tlsarr.clone();
    tlsaWild.name = `*.${this.domain}`;
    zone.insert(tlsaWild);

    const outputFile = ["Dolo", this.name, "output.toml"].join(separator);
    const originalFileContent = await readTextFile(outputFile, { dir: BaseDirectory.Document });
    const { ksk, main, zsk } = toml(originalFileContent) as unknown as ConfigFile;
    const { domain: domainPlusDot, host } = main;
    const { private: privateKSK, public: publicKSK } = ksk;
    const { private: privateZSK, public: publicZSK } = zsk;
    const domainMinusDot = domainPlusDot.slice(0, -1);

    // Create DNSKEY for ZSK
    zone.fromString(
      await readTextFile(["Dolo", domainMinusDot, "zsk", publicZSK].join(separator), {
        dir: BaseDirectory.Document
      })
    );

    // Create DNSKEY for KSK
    zone.fromString(
      await readTextFile(["Dolo", domainMinusDot, "ksk", publicKSK].join(separator), {
        dir: BaseDirectory.Document
      })
    );

    // Sign DNSKEY RRset with KSK
    const [kalg, KSKpriv] = dnssec.decodePrivate(
      await readTextFile(["Dolo", domainMinusDot, "ksk", privateKSK].join(separator), {
        dir: BaseDirectory.Document
      })
    );

    const KSKkey = dnssec.makeKey(this.domain, kalg, KSKpriv, ZONE | KSK);
    const DNSKEYrrset = this.server.zone.get(this.domain, types.DNSKEY);
    const RRSIGdnskey = dnssec.sign(KSKkey, KSKpriv, DNSKEYrrset);

    zone.insert(RRSIGdnskey);

    // Sign all other RRsets with ZSK
    const string = await readTextFile(
      ["Dolo", domainMinusDot, "zsk", privateZSK].join(separator), {
        dir: BaseDirectory.Document
      }
    );

    const [zalg, ZSKpriv] = dnssec.decodePrivate(string);
    const ZSKkey = dnssec.makeKey(this.domain, zalg, ZSKpriv, ZONE);

    for (const [, map] of zone.names) {
      for (const [, rrs] of map.rrs)
        zone.insert(dnssec.sign(ZSKkey, ZSKpriv, rrs));
    }

    // Add ZSK directly to zone to sign wildcards ad-hoc
    this.server.setZSKFromString(string);
  }

  async regenerateTLSA(): Promise<void> {
    this.server.setOrigin(this.domain);
    const zone = this.server.zone;

    // Create TLSA from certificate
    const certificateFile = ["Dolo", this.name, "tls", `${this.name}.crt`].join(separator);
    const certificateFileContent = await readTextFile(certificateFile, { dir: BaseDirectory.Document });
    const cert = new x509.X509Certificate(certificateFileContent);
    const tlsarr = tlsa.create(new Buffer(cert.rawData), this.domain, "tcp", 443);

    zone.insert(tlsarr);

    // Wildcard the TLSA for subdomains
    const tlsaWild = tlsarr.clone();
    tlsaWild.name = `*.${this.domain}`;
    zone.insert(tlsaWild);

    const domainMinusDot = this.domain.slice(0, -1);
    const outputFile = ["Dolo", this.name, "output.toml"].join(separator);
    const originalFileContent = await readTextFile(outputFile, { dir: BaseDirectory.Document });
    const { zsk } = toml(originalFileContent) as unknown as ConfigFile;
    const { private: privateZSK } = zsk;

    // Sign all other RRsets with ZSK
    const string = await readTextFile(
      ["Dolo", domainMinusDot, "zsk", privateZSK].join(separator), {
        dir: BaseDirectory.Document
      }
    );

    const [zalg, ZSKpriv] = dnssec.decodePrivate(string);
    const ZSKkey = dnssec.makeKey(this.domain, zalg, ZSKpriv, ZONE);

    for (const [, map] of zone.names) {
      for (const [, rrs] of map.rrs)
        zone.insert(dnssec.sign(ZSKkey, ZSKpriv, rrs));
    }
  }
}
