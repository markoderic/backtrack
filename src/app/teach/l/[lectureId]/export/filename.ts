/** "<lecture name>.csv", with what would break a header or a file name taken out. */
export function lectureCsvFileName(name: string): string {
  const clean = name
    .replace(/\t/g, " ")
    .replace(/["\\/\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? `${clean}.csv` : "lecture.csv";
}
