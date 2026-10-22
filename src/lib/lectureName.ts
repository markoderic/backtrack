const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Lecture 7, Oct 26": the next lecture number in the course plus today's date.
export function defaultLectureName(existingCount: number, today: Date): string {
  return `Lecture ${existingCount + 1}, ${MONTHS[today.getMonth()]} ${today.getDate()}`;
}
