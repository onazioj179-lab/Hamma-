import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import './SelectField.css';

interface Props {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  'aria-label'?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** A controlled, keyboard-accessible select with a solid viewport-aware menu. */
export function SelectField({
  value,
  onChange,
  children,
  disabled,
  id,
  className,
  'aria-label': name,
}: Props) {
  const uid = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 180,
    maxHeight: 280,
  });
  const search = useRef({ text: '', time: 0 });
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((element) => {
      const props = element.props as {
        value?: string;
        children: ReactNode;
        disabled?: boolean;
      };
      const label = String(props.children ?? '');
      return { value: props.value ?? label, label, disabled: !!props.disabled };
    });
  const selected = options.findIndex((option) => option.value === value);
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  };
  const show = () => {
    setActive(Math.max(0, selected));
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const navigation = document.querySelector('.sidebar')?.getBoundingClientRect();
      const bottom = navigation && navigation.top > 0 && navigation.width > window.innerWidth * .8
        ? Math.min(window.innerHeight, navigation.top) : window.innerHeight;
      const below = bottom - rect.bottom - 16;
      const above = rect.top - 16;
      const upward = below < 180 && above > below;
      const maxHeight = Math.min(280, Math.max(60, upward ? above : below));
      const width = Math.min(Math.max(rect.width, 184), window.innerWidth - 24);
      const height = Math.min(maxHeight, options.length * 36 + 12);
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: upward ? rect.top - height - 6 : rect.bottom + 6,
        width,
        maxHeight,
      });
    };
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (open)
      menu.current
        ?.querySelector('[data-active="true"]')
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  return (
    <span className={`select-field ${className || ''}`}>
      <button
        ref={trigger}
        id={id}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={name}
        aria-expanded={open}
        aria-controls={`${uid}-list`}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${uid}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onBlur={(event) => {
          if (!menu.current?.contains(event.relatedTarget as Node))
            setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
            return;
          }
          if (event.key === 'Tab') {
            setOpen(false);
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open ? choose(active) : show();
            return;
          }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
            const enabled = options
              .map((option, index) => (option.disabled ? -1 : index))
              .filter((index) => index >= 0);
            if (!enabled.length) return;
            const current = enabled.indexOf(
              open ? active : Math.max(0, selected),
            );
            setActive(
              event.key === 'Home'
                ? enabled[0]
                : event.key === 'End'
                  ? enabled[enabled.length - 1]
                  : enabled[
                      (current +
                        (event.key === 'ArrowDown' ? 1 : -1) +
                        enabled.length) %
                        enabled.length
                    ],
            );
          } else if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            const now = Date.now();
            search.current = {
              text:
                now - search.current.time < 700
                  ? search.current.text + event.key
                  : event.key,
              time: now,
            };
            const match = options.findIndex(
              (option) =>
                !option.disabled &&
                option.label
                  .toLowerCase()
                  .startsWith(search.current.text.toLowerCase()),
            );
            if (match >= 0) {
              setActive(match);
              setOpen(true);
            }
          }
        }}
      >
        <span>{options[selected]?.label || 'Choose an option'}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={`${uid}-list`}
            role="listbox"
            aria-label={name}
            className="select-menu"
            style={position}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${uid}-${index}`}
                role="option"
                aria-selected={value === option.value}
                aria-disabled={option.disabled || undefined}
                data-active={active === index}
                className="select-option"
                onPointerMove={() => !option.disabled && setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {value === option.value && (
                  <Check size={14} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
