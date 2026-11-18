export type FixedBlock = {
  id?: number; title: string; program?: string; resource?: string; active?: boolean;
  weekdays?: string; startTime?: string; endTime?: string; start?: string; end?: string; kind?: string;
};
export type FixedBooking = {
  date?: string; locationType?: string; startTime?: string; endTime?: string;
  usageCategory?: string; status?: string; fixedOverride?: boolean;
};
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const minutes = (value = "") => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };
export const canOverwriteFixed = (role = "") => ["administrador", "jefe_produccion"].includes(role);
export function fixedBlocksForBooking<T extends FixedBlock>(blocks: T[], booking: FixedBooking): T[] {
  if (booking.locationType === "exteriores") return [];
  const day = new Date(`${booking.date}T12:00:00-04:00`).getUTCDay();
  const end = minutes(booking.endTime) + (normalized(booking.usageCategory || "grabacion") === "GRABACION" ? 15 : 0);
  return blocks.filter(block => block.active !== false && block.resource === booking.locationType
    && (block.weekdays || "1,2,3,4,5").split(",").includes(String(day))
    && minutes(booking.startTime) < minutes(block.endTime || block.end) + (normalized(block.kind || "").includes("GRABACION") ? 15 : 0)
    && end > minutes(block.startTime || block.start));
}
export function fixedOverrideKey(booking: FixedBooking, blocks: FixedBlock[]): string {
  // Bind confirmation to the date, resource, interval and complete affected set.
  return JSON.stringify([booking.date, booking.locationType, booking.startTime, booking.endTime, booking.usageCategory || "grabacion",
    blocks.map(block => [block.id, block.title, block.program, block.startTime || block.start, block.endTime || block.end, block.kind]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}
export function visibleFixedBlocks<T extends FixedBlock>(blocks: T[], bookings: FixedBooking[], date: string): T[] {
  return blocks.filter(block => !bookings.some(booking => booking.date === date && booking.fixedOverride === true
    && ["aprobada", "retrasada", "completada"].includes(booking.status || "")
    && fixedBlocksForBooking([block], booking).length > 0));
}
