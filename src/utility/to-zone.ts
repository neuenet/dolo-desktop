


/// util

import type { LooseObject } from "../utility/interface";



/// export

export function toZone(records: Array<LooseObject>) {
  /// bns creates duplicate records and forking to fix will take some time…
  /// this is the ideal fix for now

  // use a set to track unique lines
  const uniqueLines = new Set<string>();
  const firstOccurrences: string[] = [];

  for (const record of records) {
    // remove multiple spaces within records
    const stringifiedRecord = record.toString().replace(/  +/g, " ");

    // add the line to the result if it has not been added before
    if (!uniqueLines.has(stringifiedRecord)) {
      uniqueLines.add(stringifiedRecord);
      firstOccurrences.push(stringifiedRecord);
    }
  }

  return firstOccurrences
    .join("\n")
    .trimEnd() + "\n";
}
