import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const reservations = sqliteTable("reservations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  program: text("program").notNull(),
  requestingArea: text("requesting_area").notNull().default("PRODUCCIÓN"),
  locationType: text("location_type").notNull(),
  usageCategory: text("usage_category").notNull().default("grabación"),
  locationDetail: text("location_detail").notNull().default(""),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  requester: text("requester").notNull(),
  requesterEmail: text("requester_email").notNull(),
  requesterPhone: text("requester_phone").notNull().default(""),
  crew: integer("crew").notNull().default(1),
  crewDetail: text("crew_detail").notNull().default(""),
  assignedOperators: text("assigned_operators").notNull().default("[]"),
  equipment: text("equipment").notNull().default(""),
  requirements: text("requirements").notNull().default(""),
  notes: text("notes").notNull().default(""),
  color: text("color").notNull().default("#4976BA"),
  status: text("status").notNull().default("confirmada"),
  actualStartTime: text("actual_start_time"),
  actualEndTime: text("actual_end_time"),
  cancelledAt: text("cancelled_at"),
  cancellationReason: text("cancellation_reason"),
  cancellationDetail: text("cancellation_detail"),
  rescheduleReason: text("reschedule_reason"),
  rescheduleDetail: text("reschedule_detail"),
  sameDayCancellation: integer("same_day_cancellation", { mode:"boolean" }).notNull().default(false),
  delayMinutes: integer("delay_minutes").notNull().default(0),
  delayReason: text("delay_reason"),
  approvalBy: text("approval_by").notNull().default(""),
  approvalAt: text("approval_at"),
  denialReason: text("denial_reason").notNull().default(""),
  soundSetPeople: integer("sound_set_people").notNull().default(0),
  soundMicrophones: integer("sound_microphones").notNull().default(0),
  soundInstrumentLines: integer("sound_instrument_lines").notNull().default(0),
  soundOwnSystem: integer("sound_own_system", {mode:"boolean"}).notNull().default(false),
  editingRequests: text("editing_requests").notNull().default("[]"),
  assignedEditingStaff: text("assigned_editing_staff").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  program: text("program").notNull(),
  role: text("role").notNull().default("solicitante"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reservationId: integer("reservation_id").notNull(),
  action: text("action").notNull(),
  actorEmail: text("actor_email").notNull(),
  actorName: text("actor_name").notNull(),
  changes: text("changes").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const programs = sqliteTable("programs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
  logoData: text("logo_data").notNull().default(""),
  active: integer("active", { mode:"boolean" }).notNull().default(true),
});

export const scheduleBlocks = sqliteTable("schedule_blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  program: text("program").notNull(),
  title: text("title").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  kind: text("kind").notNull(),
  color: text("color").notNull(),
  weekdays: text("weekdays").notNull().default("1,2,3,4,5"),
  active: integer("active", { mode:"boolean" }).notNull().default(true),
  resource: text("resource").notNull().default("estudio"),
  assignedStaff: text("assigned_staff").notNull().default("[]"),
});

export const inventoryItems = sqliteTable("inventory_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  category: text("category").notNull().default("Pañol"),
  stock: integer("stock"),
  unit: text("unit").notNull().default("unidad"),
  active: integer("active", { mode:"boolean" }).notNull().default(true),
});

export const technicalStaff = sqliteTable("technical_staff", {
  id: integer("id").primaryKey({ autoIncrement:true }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  studios: text("studios").notNull().default("radio,estudio,exteriores"),
  photoData: text("photo_data").notNull().default(""),
  active: integer("active",{mode:"boolean"}).notNull().default(true),
});

export const operatorShifts = sqliteTable("operator_shifts", {
  id: integer("id").primaryKey({ autoIncrement:true }),
  staffName: text("staff_name").notNull(),
  role: text("role").notNull(),
  resource: text("resource").notNull(),
  label: text("label").notNull().default("Turno operativo"),
  weekdays: text("weekdays").notNull().default("1,2,3,4,5"),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  active: integer("active",{mode:"boolean"}).notNull().default(true),
});

/** Personal del departamento de Edición. No interviene en métricas operativas. */
export const editingStaff = sqliteTable("editing_staff", {
  id: integer("id").primaryKey({ autoIncrement:true }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  active: integer("active", {mode:"boolean"}).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dutyAssignments = sqliteTable("duty_assignments", {
  id: integer("id").primaryKey({ autoIncrement:true }),
  date: text("date").notNull(),
  staffName: text("staff_name").notNull(),
  role: text("role").notNull(),
  resource: text("resource").notNull(),
  label: text("label").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  dayType: text("day_type").notNull().default("ordinario"),
  holidayName: text("holiday_name").notNull().default(""),
  multiplierX100: integer("multiplier_x100").notNull().default(100),
  notes: text("notes").notNull().default(""),
  active: integer("active",{mode:"boolean"}).notNull().default(true),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text("updated_by").notNull().default(""),
  updatedAt: text("updated_at"),
  cancelledBy: text("cancelled_by").notNull().default(""),
  cancelledAt: text("cancelled_at"),
});

export const smtpSettings = sqliteTable("smtp_settings", {
  id: integer("id").primaryKey().default(1),
  host: text("host").notNull().default(""),
  port: integer("port").notNull().default(587),
  security: text("security").notNull().default("starttls"),
  authMode: text("auth_mode").notNull().default("none"),
  username: text("username").notNull().default(""),
  password: text("password").notNull().default(""),
  fromName: text("from_name").notNull().default("Gestión de Grabaciones ED"),
  fromEmail: text("from_email").notNull().default(""),
  recipients: text("recipients").notNull().default(""),
  enabled: integer("enabled",{mode:"boolean"}).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});


export const authSessions = sqliteTable("auth_sessions", {
  token: text("token").primaryKey().notNull(),
  userEmail: text("user_email").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("auth_sessions_expiry").on(table.expiresAt)]);
