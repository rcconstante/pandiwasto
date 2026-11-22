import { Check, ChevronDown } from "lucide-react";
import { Select } from "radix-ui";

export function ArcadeSelect({ label, name, options, value, defaultValue, onValueChange, disabled }: {
  label: string;
  name?: string;
  options: { label: string; value: string }[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className="pwd-select-field">
      <span>{label}</span>
      <Select.Root name={name} value={value} defaultValue={defaultValue} onValueChange={onValueChange} disabled={disabled}>
        <Select.Trigger className="pwd-select-trigger" aria-label={label}>
          <Select.Value />
          <Select.Icon asChild><ChevronDown size={17} aria-hidden="true" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="pwd-select-list" position="popper" sideOffset={5}>
            <Select.Viewport className="pwd-select-viewport">
              {options.map((option) => (
                <Select.Item className="pwd-select-option" key={option.value} value={option.value}>
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator><Check size={15} aria-hidden="true" /></Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </span>
  );
}
