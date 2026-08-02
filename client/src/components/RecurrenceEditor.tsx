import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Input, Button } from '@databricks/appkit-ui/react';

export interface RecurrenceValue {
  kind: 'schedule' | 'after_done';
  interval: number;
  unit?: 'day' | 'week' | 'month' | null;
  weekdays?: number[] | null;
  monthday?: number | null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function RecurrenceEditor({
  value,
  onChange,
  disabled,
}: {
  value: RecurrenceValue | null;
  onChange: (v: RecurrenceValue | null) => void;
  disabled?: boolean;
}) {
  const kind = value?.kind ?? 'none';

  return (
    <div className="space-y-2">
      <Select
        disabled={disabled}
        value={kind}
        onValueChange={(k) => {
          if (k === 'none') onChange(null);
          else if (k === 'after_done') onChange({ kind: 'after_done', interval: value?.interval ?? 7 });
          else onChange({ kind: 'schedule', interval: value?.interval ?? 1, unit: value?.unit ?? 'week', weekdays: value?.weekdays ?? [] });
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Doesn&apos;t repeat</SelectItem>
          <SelectItem value="schedule">On a schedule</SelectItem>
          <SelectItem value="after_done">Some days after I finish it</SelectItem>
        </SelectContent>
      </Select>

      {value?.kind === 'after_done' && (
        <label className="flex items-center gap-2 text-sm">
          <Input
            type="number"
            min={1}
            max={365}
            disabled={disabled}
            className="w-20"
            value={value.interval}
            onChange={(e) => onChange({ ...value, interval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          />
          days after each completion
        </label>
      )}

      {value?.kind === 'schedule' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            every
            <Input
              type="number"
              min={1}
              max={365}
              disabled={disabled}
              className="w-16"
              value={value.interval}
              onChange={(e) => onChange({ ...value, interval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            />
            <Select
              disabled={disabled}
              value={value.unit ?? 'week'}
              onValueChange={(unit) =>
                onChange({ ...value, unit: unit as RecurrenceValue['unit'], weekdays: unit === 'week' ? (value.weekdays ?? []) : null, monthday: unit === 'month' ? (value.monthday ?? null) : null })
              }
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">day(s)</SelectItem>
                <SelectItem value="week">week(s)</SelectItem>
                <SelectItem value="month">month(s)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {value.unit === 'week' && (
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((name, i) => {
                const active = value.weekdays?.includes(i) ?? false;
                return (
                  <Button
                    key={name}
                    type="button"
                    size="sm"
                    disabled={disabled}
                    variant={active ? 'default' : 'outline'}
                    className="px-2 h-7 text-xs"
                    onClick={() => {
                      const cur = value.weekdays ?? [];
                      onChange({ ...value, weekdays: active ? cur.filter((d) => d !== i) : [...cur, i].sort() });
                    }}
                  >
                    {name}
                  </Button>
                );
              })}
            </div>
          )}
          {value.unit === 'month' && (
            <label className="flex items-center gap-2 text-sm">
              on day
              <Input
                type="number"
                min={1}
                max={31}
                disabled={disabled}
                className="w-16"
                value={value.monthday ?? 1}
                onChange={(e) => onChange({ ...value, monthday: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
              />
              of the month
            </label>
          )}
        </div>
      )}
    </div>
  );
}
