// Server snapshots are remaining seconds, not client wall-clock timestamps.
export default class RoomCountdown {
    private seconds:number = null;
    private sampledAt = 0;
    private lastMono = 0;
    private lastWall = 0;
    public started = false;

    invalidate():void { this.seconds = null; }

    sync(value:any, started:boolean, mono:number, wall:number):void {
        this.started = started;
        const seconds = typeof value === "number" ? value :
            (typeof value === "string" && value.trim() !== "" ? Number(value) : NaN);
        if (!started || !isFinite(seconds) || seconds > 31536000) {
            this.invalidate();
            return;
        }
        this.seconds = Math.max(0, seconds);
        this.sampledAt = this.lastMono = mono;
        this.lastWall = wall;
    }

    remaining(mono:number, wall:number, monotonic:boolean = true):number {
        if (!this.started || this.seconds === null) return null;
        // Native fallback clocks can jump; suspend/resume also needs a new snapshot.
        if (mono < this.lastMono || (!monotonic && mono - this.lastMono > 5000) || Math.abs((wall - this.lastWall) - (mono - this.lastMono)) > 2000) {
            this.invalidate();
            return null;
        }
        this.lastMono = mono;
        this.lastWall = wall;
        return Math.max(0, Math.ceil(this.seconds - (mono - this.sampledAt) / 1000));
    }

    static format(seconds:number, hours:boolean = false):string {
        const value = isFinite(seconds) ? Math.max(0, Math.min(31536000, Math.floor(seconds))) : 0;
        const minutes = hours ? Math.floor(value / 60) % 60 : Math.floor(value / 60);
        return (hours ? Math.floor(value / 3600).toString().padStart(2, "0") + ":" : "") +
            minutes.toString().padStart(2, "0") + ":" + (value % 60).toString().padStart(2, "0");
    }
}
