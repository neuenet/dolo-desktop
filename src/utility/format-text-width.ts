


/// export

export function formatTextToWidth(text: string, width: number): string {
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
