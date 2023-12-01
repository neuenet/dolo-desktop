


/// export

export function generateSerial(length: number): string {
  let serial = '';

  for (let i = 0; i < length; i++) {
    // Generate a random byte (0 - 255)
    const byte = Math.floor(Math.random() * 256);

    // Convert the byte to a hexadecimal string and add it to the serial number
    serial += byte.toString(16).padStart(2, "0").toUpperCase();

    // Optionally add a space for readability
    if ((i + 1) % 2 === 0 && i < length - 1)
      serial += " ";
  }

  return serial;
}
