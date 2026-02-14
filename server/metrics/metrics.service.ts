import { Injectable, Inject } from "@nestjs/common";
import { Sequelize } from "sequelize-typescript";
import { Registry, Gauge, Counter, collectDefaultMetrics } from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry: Registry;

  // Gauges — current state from DB
  private readonly drawingsGauge: Gauge;
  private readonly usersGauge: Gauge;
  private readonly sessionsGauge: Gauge;

  // Counters — cumulative since process start
  private readonly drawingsCreatedCounter: Counter;
  private readonly drawingsDeletedCounter: Counter;

  constructor(@Inject(Sequelize) private readonly sequelize: Sequelize) {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ service: "nib" });

    // Collect default Node.js metrics (GC, event loop, memory, etc.)
    collectDefaultMetrics({ register: this.registry });

    // --- Gauges (populated on each scrape via async collect callbacks) ---

    this.drawingsGauge = new Gauge({
      name: "nib_drawings_total",
      help: "Current number of drawings by visibility",
      labelNames: ["visibility"] as const,
      registers: [this.registry],
      collect: async () => {
        await this.collectDrawingCounts();
      },
    });

    this.usersGauge = new Gauge({
      name: "nib_users_total",
      help: "Total number of registered users",
      registers: [this.registry],
      collect: async () => {
        await this.collectUserCount();
      },
    });

    this.sessionsGauge = new Gauge({
      name: "nib_sessions_active",
      help: "Number of active sessions in the session store",
      registers: [this.registry],
      collect: async () => {
        await this.collectSessionCount();
      },
    });

    // --- Counters ---

    this.drawingsCreatedCounter = new Counter({
      name: "nib_drawings_created_total",
      help: "Cumulative number of drawings created since process start",
      labelNames: ["visibility"] as const,
      registers: [this.registry],
    });

    this.drawingsDeletedCounter = new Counter({
      name: "nib_drawings_deleted_total",
      help: "Cumulative number of drawings deleted since process start",
      registers: [this.registry],
    });
  }

  // --- Public methods called by other services ---

  incDrawingCreated(isPublic: boolean): void {
    this.drawingsCreatedCounter.inc({ visibility: isPublic ? "public" : "private" });
  }

  incDrawingDeleted(): void {
    this.drawingsDeletedCounter.inc();
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }

  // --- Private collect callbacks ---

  private async collectDrawingCounts(): Promise<void> {
    try {
      const [results] = await this.sequelize.query(
        `SELECT is_public, COUNT(*) AS count FROM scenes GROUP BY is_public`,
      );
      // Reset before setting to avoid stale labels
      this.drawingsGauge.reset();
      for (const row of results as Array<{ is_public: boolean | number; count: number | string }>) {
        // SQLite returns 0/1 for booleans; Postgres returns true/false
        const visibility = (row.is_public === true || row.is_public === 1) ? "public" : "private";
        this.drawingsGauge.set({ visibility }, Number(row.count));
      }
    } catch {
      // DB may be unreachable — leave gauge at 0
    }
  }

  private async collectUserCount(): Promise<void> {
    try {
      const [results] = await this.sequelize.query(
        `SELECT COUNT(*) AS count FROM users`,
      );
      const count = Number((results as Array<{ count: number | string }>)[0]?.count ?? 0);
      this.usersGauge.set(count);
    } catch {
      // DB may be unreachable
    }
  }

  private async collectSessionCount(): Promise<void> {
    try {
      // connect-pg-simple stores sessions in the "session" table
      // This query only works in PostgreSQL (production); silently fails in SQLite (tests)
      const [results] = await this.sequelize.query(
        `SELECT COUNT(*) AS count FROM session WHERE expire > NOW()`,
      );
      const count = Number((results as Array<{ count: number | string }>)[0]?.count ?? 0);
      this.sessionsGauge.set(count);
    } catch {
      // Table doesn't exist (dev/test) or DB unreachable — leave at 0
    }
  }
}
