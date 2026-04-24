// Minimal stubs for @ionic/react so tests run in jsdom without
// the Ionic web components runtime.
import React from "react";

type DivProps = React.HTMLAttributes<HTMLDivElement>;
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const IonApp = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
export const IonPage = ({ children }: { children?: React.ReactNode }) => <div className="ion-page">{children}</div>;
export const IonHeader = ({ children }: { children?: React.ReactNode }) => <header>{children}</header>;
export const IonToolbar = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
export const IonTitle = ({ children }: { children?: React.ReactNode }) => <h1>{children}</h1>;
export const IonContent = ({ children, ...rest }: DivProps) => <div {...rest}>{children}</div>;
export const IonText = ({ children }: { children?: React.ReactNode }) => <span>{children}</span>;
export const IonProgressBar = () => <progress />;
export const IonToast = ({
  isOpen,
  message,
  onDidDismiss,
}: {
  isOpen?: boolean;
  message?: string;
  duration?: number;
  onDidDismiss?: () => void;
}) =>
  isOpen ? (
    <div role="status" aria-live="polite" onClick={onDidDismiss}>
      {message}
    </div>
  ) : null;

export const IonButton = ({
  children,
  expand: _expand,
  fill: _fill,
  ...rest
}: ButtonProps & { expand?: string; fill?: string }) => (
  <button type="button" {...rest}>
    {children}
  </button>
);

export const IonRange = ({
  value,
  min,
  max,
  step,
  onIonChange,
}: {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  onIonChange?: (e: { detail: { value: number } }) => void;
}) => (
  <input
    type="range"
    value={value}
    min={min}
    max={max}
    step={step}
    onChange={(e) => onIonChange?.({ detail: { value: Number(e.target.value) } })}
  />
);

export const IonRouterOutlet = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
export const IonReactRouter = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
export const IonButtons = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
export const IonBackButton = ({ text, defaultHref: _defaultHref }: { text?: string; defaultHref?: string }) => (
  <button type="button">{text ?? "Back"}</button>
);
