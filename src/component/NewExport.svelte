<script lang="ts">
  /// import
  import { BaseDirectory, createDir, exists, readDir, readTextFile, removeFile, writeTextFile } from "@tauri-apps/api/fs";
  import dedent from "dedent";
  import { ed25519 } from "@noble/curves/ed25519";
  import { parse as toml } from "smol-toml";
  import { sep as separator } from "@tauri-apps/api/path";
  import * as x509 from "@peculiar/x509";

  /// util
  import { default as bns } from "../utility/bns";
  import { entry, readyForStep2 } from "../utility/store";
  import type { LooseObject } from "../utility/interface";

  /// component
  import ProgressBar from "./ProgressBar.svelte";

  /// variable
  const { AuthServer, dnssec, constants } = bns;
  const { types } = constants;
  const KSK = 1 << 0;
  const ZONE = 1 << 8;
  let domain = ($entry as LooseObject).domain || "";
  let isDomainValid = false;
  let isNameserver1Valid = false;
  let nameserver1 = ($entry as LooseObject).nameserver1 || "";
  let progress: ProgressBar;

  /// function
  async function generateFiles(event: any) {
    event.preventDefault();

    entry.set({ domain, nameserver1 });
    progress.setWidthRatio(0);

    await generateCerts();
    await generateKSKKeys();
    await generateZSKKeys();
    await generateOutputFile();
    await generateZoneFile();

    progress.complete();
    readyForStep2.set(true);
  }

  async function generateCerts() {
    console.group("generateCerts()");
    const { domain, nameserver1 } = $entry;

    const alg = {
      hash: "SHA-512",
      modulusLength: 4096,
      name: "RSASSA-PKCS1-v1_5",
      publicExponent: new Uint8Array([1, 0, 1])
    };

    const certFile = ["Dolo", domain, "tls", `${domain}.crt`].join(separator);
    const certFolder = ["Dolo", domain, "tls"].join(separator);
    const keyFile = ["Dolo", domain, "tls", `${domain}.key`].join(separator);

    const keys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
    const serialNumber = getYesterdayDate().split("/").join("") + "00";

    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      extensions: [
        new x509.BasicConstraintsExtension(false, 0, false),
        new x509.KeyUsagesExtension(
          x509.KeyUsageFlags.digitalSignature |
          x509.KeyUsageFlags.nonRepudiation |
          x509.KeyUsageFlags.keyEncipherment |
          x509.KeyUsageFlags.dataEncipherment,
          false
        ),
        new x509.SubjectAlternativeNameExtension([
          { type: "dns", value: domain },
          { type: "dns", value: `*.${domain}` },
          { type: "ip", value: nameserver1 }
        ], false)
      ],
      keys,
      name: `CN=${domain}`,
      notBefore: new Date(getYesterdayDate()),
      notAfter: new Date(getYesterdayDate()),
      serialNumber,
      signingAlgorithm: alg
    });

    const doesDomainCertDirectoryExist = await exists(certFolder, { dir: BaseDirectory.Document });

    if (!doesDomainCertDirectoryExist) {
      await createDir(certFolder, { dir: BaseDirectory.Document, recursive: true });
      console.info(`WRITE | ${certFolder}.crt`);
    }

    await writeTextFile(certFile, cert.toString("pem"), { dir: BaseDirectory.Document });
    console.info(`WRITE | ${domain}.crt`);

    /// export private key to PKCS #8 format
    const exportKey = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
    /// convert ArrayBuffer to Uint8Array
    const exportKeyAsString = new Uint8Array(exportKey);
    /// convert Uint8Array to base64-encoded string
    const exportKeyAsBase64 = btoa(String.fromCharCode(...exportKeyAsString));
    /// add headers for PEM format
    const privateKeyPEM = `-----BEGIN PRIVATE KEY-----\n${formatTextToWidth(exportKeyAsBase64, 64)}\n-----END PRIVATE KEY-----`;

    await writeTextFile(keyFile, privateKeyPEM, { dir: BaseDirectory.Document });
    console.info(`WRITE | ${domain}.key`);
    console.groupEnd();
    progress.setWidthRatio(0.2);
  }

  async function generateKSKKeys() {
    console.group("generateKSKKeys()");
    const { domain, nameserver1 } = $entry;
    const privateKey = ed25519.utils.randomPrivateKey(); /// Uint8Array (Buffer)
    const publicKey = ed25519.getPublicKey(privateKey);  /// Uint8Array (Buffer)

    const kkey = {
      class: "IN", // 1 | https://github.com/pinheadmz/bns/blob/master/lib/constants.js#L373 (classes.IN)
      data: {
        algorithm: 15, // ED25519
        flags: ZONE | KSK,
        protocol: 3,
        publicKey
      },
      name: `${domain}.`,
      ttl: 172800,
      type: "DNSKEY" // 48 | https://github.com/pinheadmz/bns/blob/master/lib/constants.js#L209 (types.DNSKEY)
    };

    const kskFolder = ["Dolo", domain, "ksk"].join(separator);
    const doesKSKDirectoryExist = await exists(kskFolder, { dir: BaseDirectory.Document });

    if (!doesKSKDirectoryExist) {
      await createDir(kskFolder, { dir: BaseDirectory.Document, recursive: true });
    } else {
      /// clear out directory because filenames change on key generation...
      /// repeat regenerations make a bulky directory
      const directoryList = await readDir(kskFolder, { dir: BaseDirectory.Document, recursive: true });

      for (const item of directoryList) {
        // TODO: account for any hidden file(s)
        if (item.path.includes(".DS_Store"))
          continue;
        else
          await removeFile(item.path, { dir: BaseDirectory.Document });
      }
    }

    const rd = kkey.data;

    /// writePrivate

    const kskPrivateFilename = privFile(kkey.name, rd.protocol, calculateKeyTag(rd));
    const kskPrivateContents = encodePrivate(privateKey, getCurrentDateTime());
    const kskPrivateFile = [kskFolder, kskPrivateFilename].join(separator);

    await writeTextFile(kskPrivateFile, kskPrivateContents, { dir: BaseDirectory.Document });
    console.info(`WRITE | ${kskPrivateFilename}`);

    /// writePublic

    const kskPublicFilename = pubFile(kkey.name, rd.protocol, calculateKeyTag(rd));
    const kskPublicContents = recordToString(kkey, "KSK");
    const kskPublicFile = [kskFolder, kskPublicFilename].join(separator);

    await writeTextFile(kskPublicFile, kskPublicContents, { dir: BaseDirectory.Document });
    console.info(`WRITE | ${kskPublicFilename}`);

    /// create DS record

    const dsRecord = {
      algorithm: 15,
      keyTag: calculateKeyTag(rd),
      publicKey: uint8ArrayToHex(publicKey).toUpperCase(),
      ttl: 172800
    };

    const recordRoot = `${domain}. ${dsRecord.ttl} IN DS ${dsRecord.keyTag} ${dsRecord.algorithm} ${dsRecord.publicKey}`;
    const recordDS = recordRoot.split("DS")[1].trim();
    const recordGlue = `ns.${domain}. ${nameserver1}`;
    const recordNS = `ns.${domain}.`;
    const recordsFile = ["Dolo", domain, "records.toml"].join(separator);

    const recordsFileContents = [
      "[root]",
      `record = "${recordRoot}"\n`,
      "[wallet]",
      `ds     = "${recordDS}"`,
      `glue4  = "${recordGlue}"`,
      `ns     = "${recordNS}"`
    ].join("\n") + "\n";

    await writeTextFile(recordsFile, recordsFileContents, { dir: BaseDirectory.Document });
    console.info("WRITE | records.toml");
    console.groupEnd();
    progress.setWidthRatio(0.4);
  }

  async function generateOutputFile() {
    console.group("generateOutputFile()");
    const { domain, nameserver1 } = $entry;
    const kskFolder = ["Dolo", domain, "ksk"].join(separator);
    const zskFolder = ["Dolo", domain, "zsk"].join(separator);
    let kskPublicFilename = "";
    let kskPrivateFilename = "";
    let zskPublicFilename = "";
    let zskPrivateFilename = "";

    const kskDirectoryList = await readDir(kskFolder, { dir: BaseDirectory.Document, recursive: true });
    const zskDirectoryList = await readDir(zskFolder, { dir: BaseDirectory.Document, recursive: true });

    for (const item of kskDirectoryList) {
      if (item.path.endsWith(".key"))
        kskPublicFilename = item.path.split(`ksk${separator}`)[1];

      if (item.path.endsWith(".private"))
        kskPrivateFilename = item.path.split(`ksk${separator}`)[1];
    }

    for (const item of zskDirectoryList) {
      if (item.path.endsWith(".key"))
        zskPublicFilename = item.path.split(`zsk${separator}`)[1];

      if (item.path.endsWith(".private"))
        zskPrivateFilename = item.path.split(`zsk${separator}`)[1];
    }

    const outputFileContent = [
      "[main]",
      `domain  = "${domain}."`,
      `host    = "${nameserver1}"\n`,
      "[ksk]",
      `public  = "${kskPublicFilename}"`,
      `private = "${kskPrivateFilename}"\n`,
      "[zsk]",
      `public  = "${zskPublicFilename}"`,
      `private = "${zskPrivateFilename}"`
    ].join("\n");

    const outputFile = ["Dolo", domain, "output.toml"].join(separator);
    await writeTextFile(outputFile, outputFileContent, { dir: BaseDirectory.Document });

    console.info("WRITE | output.toml");
    console.groupEnd();
    progress.setWidthRatio(0.8);
  }

  async function generateZoneFile() {
    console.group("generateZoneFile()");

    interface ConfigFile {
      ksk: {
        private: string;
        public: string;
      },
      main: {
        domain: string;
        host: string;
      },
      zsk: {
        private: string;
        public: string;
      }
    }

    const { domain: configDomain } = $entry;
    const certificateFile = ["Dolo", configDomain, "tls", `${configDomain}.crt`].join(separator);
    const outputFile = ["Dolo", configDomain, "output.toml"].join(separator);
    const originalFileContent = await readTextFile(outputFile, { dir: BaseDirectory.Document });
    const certificateFileContent = await readTextFile(certificateFile, { dir: BaseDirectory.Document });

    const { ksk, main, zsk } = toml(originalFileContent) as unknown as ConfigFile;
    const { domain: domainPlusDot, host } = main;
    const { private: privateKSK, public: publicKSK } = ksk;
    const { private: privateZSK, public: publicZSK } = zsk;
    const domainMinusDot = domainPlusDot.slice(0, -1);
    let records: any[] = [];

    /// Create TLSA from certificate
    const normalizedPem = certificateFileContent.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\n/g, "");
    const { publicKey: publicKeyObject } = new x509.X509Certificate(normalizedPem);

    // Import the PEM data as a CryptoKey
    const publicKey = await crypto.subtle.importKey(
      "spki",
      publicKeyObject.rawData, {
        hash: "SHA-512",
        name: "RSASSA-PKCS1-v1_5"
      },
      true,
      ["verify"]
    );

    // Export the CryptoKey as a DER-encoded ArrayBuffer
    const publicKeyBuffer = await crypto.subtle.exportKey("spki", publicKey);

    // Generate the TLSA record
    const sha512Hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-512", publicKeyBuffer)))
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");

    /// Create DNSKEY for ZSK/KSK
    const kskFile = ["Dolo", domainMinusDot, "ksk", publicKSK].join(separator); //
    const kskDNSRecord = await readTextFile(kskFile, { dir: BaseDirectory.Document });

    const zskFile = ["Dolo", domainMinusDot, "zsk", publicZSK].join(separator); //
    const zskDNSRecord = await readTextFile(zskFile, { dir: BaseDirectory.Document });

    const kskFilePrivate = ["Dolo", domainMinusDot, "ksk", privateKSK].join(separator); //
    const kskFilePrivateContent = await readTextFile(kskFilePrivate, { dir: BaseDirectory.Document });

    const zskFilePrivate = ["Dolo", domainMinusDot, "zsk", privateZSK].join(separator); //
    const zskFilePrivateContent = await readTextFile(zskFilePrivate, { dir: BaseDirectory.Document });

    const server = new AuthServer({
      dnssec: true,   /// add EDNS0 DO bit in responses
      edns: true,     /// add EDNS0 OPT record in responses
      ednsSize: 4096, /// set the UDP buffer size to 4096
      tcp: true       /// allow queries over TCP
    });

    server.setOrigin(domainPlusDot);
    const { zone } = server;

    const intro = dedent`
      ;
      ; ZONE data file for ${domainMinusDot.toUpperCase()}
      ;

      $TTL 604800
      $ORIGIN ${domainPlusDot}

      ; SERIAL - current date (ChronVer) + increment ; REFRESH ; RETRY ; EXPIRE ; MINIMUM
      @ IN SOA ns.${domainPlusDot} admin.nic.${domainPlusDot} ${chronver().replace(/\./g, "")} 604800 86400 2419200 604800

      ;
      ; Nameserver Info
      ;

      @ IN NS ns.${domainPlusDot}
      @ IN A ${host}
      ; @ IN AAAA <your nameserver IPV6 address>
      ns.${domainPlusDot} IN A ${host}

      ;
      ; Domain/Website Info
      ;

      ${domainPlusDot} IN NS ns.${domainPlusDot}\n
    `;

    zone.fromString(`${domainPlusDot} 21600 IN A ${host}`);
    zone.fromString(`*.${domainPlusDot} 21600 IN A ${host}`);
    zone.fromString(`_443._tcp 3600 IN TLSA 3 1 2 ${sha512Hash}; usage = Domain Issued Certificate ; selector = SPKI ; matching type = SHA512`);

    // Create DNSKEY for KSK
    zone.fromString(kskDNSRecord);
    // Create DNSKEY for ZSK
    zone.fromString(zskDNSRecord);

    // Sign DNSKEY RRset with KSK
    const [kalg, KSKpriv] = dnssec.decodePrivate(kskFilePrivateContent);
    const KSKkey = dnssec.makeKey(domainPlusDot, kalg, KSKpriv, ZONE | KSK);
    const DNSKEYrrset = zone.get(domainPlusDot, types.DNSKEY);
    const RRSIGdnskey = dnssec.sign(KSKkey, KSKpriv, DNSKEYrrset);
    zone.insert(RRSIGdnskey);

    // Sign all other RRsets with ZSK
    const [zalg, ZSKpriv] = dnssec.decodePrivate(zskFilePrivateContent);
    const ZSKkey = dnssec.makeKey(domainPlusDot, zalg, ZSKpriv, ZONE);

    for (const [, map] of zone.names) {
      for (const [, rrs] of map.rrs)
        zone.insert(dnssec.sign(ZSKkey, ZSKpriv, rrs));
    }

    // Add ZSK directly to zone to sign wildcards ad-hoc
    server.setZSKFromString(zskFilePrivateContent);

    zone.names.forEach((recordMap: { rrs: LooseObject, sigs: LooseObject, zone: LooseObject }) => {
      recordMap.rrs.forEach((rr: any) => records = records.concat(rr));
      recordMap.sigs.forEach((rr: any) => records = records.concat(rr));
    });

    const zonefileContent = toZone(records).replace(/  +/g, " ").trim();

    /// write zonefile
    const zoneFile = ["Dolo", domain, `db.${domainMinusDot}`].join(separator);
    await writeTextFile(zoneFile, intro + zonefileContent, { dir: BaseDirectory.Document });

    console.info(`WRITE | db.${domainMinusDot}`);
    console.groupEnd();
  }

  async function generateZSKKeys() {
    console.group("generateZSKKeys()");
    const { domain } = $entry;
    const privateKey = ed25519.utils.randomPrivateKey(); /// Uint8Array (Buffer)
    const publicKey = ed25519.getPublicKey(privateKey);  /// Uint8Array (Buffer)

    const kkey = {
      class: "IN",     // 1 | https://github.com/pinheadmz/bns/blob/master/lib/constants.js#L373 (classes.IN)
      data: {
        algorithm: 15, // ED25519
        flags: ZONE,
        protocol: 3,
        publicKey
      },
      name: `${domain}.`,
      ttl: 172800,
      type: "DNSKEY"   // 48 | https://github.com/pinheadmz/bns/blob/master/lib/constants.js#L209 (types.DNSKEY)
    };

    const zskFolder = ["Dolo", domain, "zsk"].join(separator);
    const doesZSKDirectoryExist = await exists(zskFolder, { dir: BaseDirectory.Document });

    if (!doesZSKDirectoryExist) {
      await createDir(zskFolder, { dir: BaseDirectory.Document, recursive: true });
    } else {
      /// clear out directory because filenames change on key generation...
      /// repeat regenerations make a bulky directory
      const directoryList = await readDir(zskFolder, { dir: BaseDirectory.Document, recursive: true });

      for (const item of directoryList) {
        // TODO: account for any hidden file(s)
        if (item.path.includes(".DS_Store"))
          continue;
        else
          await removeFile(item.path, { dir: BaseDirectory.Document });
      }
    }

    const rd = kkey.data;

    /// writePrivate

    const zskPrivateFilename = privFile(kkey.name, rd.protocol, calculateKeyTag(rd));
    const zskPrivateContents = encodePrivate(privateKey, getCurrentDateTime());
    const zskPrivateFile = [zskFolder, zskPrivateFilename].join(separator);

    await writeTextFile(zskPrivateFile, zskPrivateContents, { dir: BaseDirectory.Document });
    console.info(`WRITE | ${zskPrivateFilename}`);

    /// writePublic

    const zskPublicFilename = pubFile(kkey.name, rd.protocol, calculateKeyTag(rd));
    const zskPublicContents = recordToString(kkey, "ZSK");
    const zskPublicFile = [zskFolder, zskPublicFilename].join(separator);

    await writeTextFile(zskPublicFile, zskPublicContents, { dir: BaseDirectory.Document });
    console.info(`WRITE | ${zskPublicFilename}`);
    console.groupEnd();
    progress.setWidthRatio(0.6);
  }

  function validateDomain(suppliedDomain: string): undefined {
    if (suppliedDomain.length > 0)
      isDomainValid = true;
    else
      isDomainValid = false;
  }

  function validateNameserver1(ip: string): undefined {
    if (validateIPAddress(ip))
      isNameserver1Valid = true;
    else
      isNameserver1Valid = false;
  }

  /// helper
  function chronver(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    let increment = 0;

    return `${year}.${month}.${day}.${increment}`;
  }

  function calculateKeyTag(dnskeyRecord: any): number {
    const { algorithm, flags, protocol, publicKey } = dnskeyRecord;

    // Concatenate the fields into a binary string
    const keyDataArray = new Uint8Array([
      (flags >> 8) & 0xff,
      flags & 0xff,
      protocol,
      algorithm,
      ...publicKey
    ]);

    // Perform 16-bit checksum
    let keyTag = 0;

    for (let i = 0; i < keyDataArray.length; i += 2) {
      keyTag += (keyDataArray[i] << 8) | keyDataArray[i + 1];
    }

    keyTag = (keyTag & 0xffff) + ((keyTag >> 16) & 0xffff);
    return keyTag & 0xffff;

    /// ^ ChatGPT 3.5
  }

  function encodePrivate(raw: Uint8Array, time: string) {
    return [
      "Private-key-format: v1.3",
      "Algorithm: 15 (ED25519)",
      `PrivateKey: ${uint8ArrayToBase64(raw)}`,
      `Created: ${time}`,
      `Publish: ${time}`,
      `Activate: ${time}`
    ].join("\n") + "\n";
  }

  function formatTextToWidth(text: string, width: number): string {
    let currentLine = "";
    let formattedText = "";

    for (let i = 0; i < text.length; i++) {
      currentLine += text[i];

      if (currentLine.length === width) {
        formattedText += currentLine + "\n";
        currentLine = "";
      } else if (i === text.length - 1) {
        formattedText += currentLine;
      }
    }

    return formattedText;
  }

  function getCurrentDateTime(): string {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  function getYesterdayDate(): string {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getDate()).padStart(2, "0");

    return `${year}/${month}/${day}`;
  }

  function pad(num: number, len: number) {
    let str = num.toString(10);

    while (str.length < len)
      str = `0${str}`;

    return str;
  }

  function privFile(name: string, alg: number, tag: number) {
    const fqdn = name.toLowerCase(); // + ".";
    const file = `K${fqdn}+${pad(alg, 3)}+${pad(tag, 5)}`;

    return `${file}.private`;
  }

  function pubFile(name: string, alg: number, tag: number) {
    const fqdn = name.toLowerCase(); // + ".";
    const file = `K${fqdn}+${pad(alg, 3)}+${pad(tag, 5)}`;

    return `${file}.key`;
  }

  function recordToString(rr: any, commentType: string): string {
    const {
      class: klass,
      data: {
        algorithm,
        flags,
        protocol,
        publicKey
      },
      name,
      ttl,
      type
    } = rr;

    const keyId = calculateKeyTag(rr.data);

    return [
      name,
      ttl,
      klass,
      type,
      flags,
      protocol,
      algorithm,
      uint8ArrayToBase64(publicKey),
      `; ${commentType} ; alg = ED25519 ; key id = ${keyId}`
    ].join(" ") + "\n";
  }

  function toZone(records: Array<LooseObject>) {
    let text = "";

    for (const record of records) {
      text += record.toString() + "\n";
    }

    return text;
    /// via https://github.com/pinheadmz/bns/blob/cname1/lib/wire.js
  }

  function uint8ArrayToBase64(uint8Array: Uint8Array): string {
    // Create a binary string from the Uint8Array
    let binaryString = "";

    for (let i = 0; i < uint8Array.length; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }

    // Use btoa to convert the binary string to base64
    return btoa(binaryString);
  }

  function uint8ArrayToHex(uint8Array: Uint8Array): string {
    return Array.from(uint8Array)
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function validateIPAddress(ip: string) {
    return validateIPv4(ip) || validateIPv6(ip);
  }

  function validateIPv4(ip: string) {
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = ip.match(ipv4Regex);

    if (!match)
      return false;

    for (let i = 1; i <= 4; i++) {
      const octet = parseInt(match[i], 10);

      if (octet < 0 || octet > 255)
        return false;
    }

    return true;
  }

  function validateIPv6(ip: string) {
    // const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){1,7}(:[0-9a-fA-F]{1,4}){1,7}$/; /// accounts for double colons
    return ipv6Regex.test(ip);
  }

  /// dynamic variable
  $: proceed = () => {
    if (isDomainValid && isNameserver1Valid)
      return true;
    else
      return false;
  }
</script>

<style lang="scss">
  form {
    fieldset {
      padding: 0 var(--line-height) var(--line-height);

      &:not(:last-child) {
        border-bottom: 1px solid;
        border-bottom-color: var(--dolo-palette-input-background);
        padding-bottom: 1.5rem;
      }

      button:not(:disabled) {
        background-color: var(--dolo-palette-foreground);
        color: var(--dolo-palette-background);
      }
    }

    input.valid {
      border-color: var(--dolo-palette-success);
    }
  }
</style>

<ProgressBar bind:this={progress}/>

<form>
  <fieldset>
    <label for="domain">Domain</label>
    <!-- svelte-ignore a11y-autofocus -->
    <input
      autofocus
      bind:value={domain}
      class:valid={isDomainValid}
      id="domain"
      name="domain"
      on:keyup={validateDomain(domain)}
      spellcheck=false
      type="text"/>

    <br/><br/>

    <label for="nameserver1">Nameserver</label>
    <input
      bind:value={nameserver1}
      class:valid={isNameserver1Valid}
      id="nameserver1"
      name="nameserver1"
      on:keyup={validateNameserver1(nameserver1)}
      spellcheck=false
      type="text"/>
  </fieldset>

  <fieldset>
    <button
      disabled={!proceed()}
      on:click={generateFiles}
      type="submit">Generate</button>
  </fieldset>
</form>
