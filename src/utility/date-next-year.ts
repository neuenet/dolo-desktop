


/// export

export function getNextYearDate(): string {
  const today = new Date();
  const nextYear = new Date(today);
  nextYear.setFullYear(today.getFullYear() + 1);

  const year = nextYear.getFullYear();
  const month = String(nextYear.getMonth() + 1).padStart(2, "0");
  const day = String(nextYear.getDate()).padStart(2, "0");

  return `${year}/${month}/${day}`;
}
