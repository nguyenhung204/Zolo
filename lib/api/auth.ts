import { apiClient, unwrap } from "@/lib/api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RegisterInitDto {
  email: string;
  firstName: string;
  lastName: string;
}

export interface RegisterInitResponse {
  cooldownSeconds: number;
}

export interface RegisterVerifyOtpDto {
  email: string;
  otp: string;
}

export interface RegisterVerifyOtpResponse {
  registrationToken: string;
  expiresIn: number;
}

export interface RegisterCompleteDto {
  registrationToken: string;
  password: string;
  platform: "web" | "mobile";
  deviceInfo?: { deviceName?: string };
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface VerifyOtpDto {
  email: string;
  otp: string;
}

export interface VerifyOtpResponse {
  resetToken: string;
  expiresIn: number;
}

export interface ResetPasswordDto {
  resetToken: string;
  newPassword: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

// ─── Registration (3-step) ────────────────────────────────────────────────────

/** Step 1 — initiate registration; triggers OTP email */
export async function registerInit(dto: RegisterInitDto): Promise<RegisterInitResponse> {
  const res = await apiClient.post<{ data: RegisterInitResponse }>("/auth/register/init", dto);
  return unwrap(res);
}

/** Step 2 — verify OTP; returns short-lived registrationToken */
export async function registerVerifyOtp(dto: RegisterVerifyOtpDto): Promise<RegisterVerifyOtpResponse> {
  const res = await apiClient.post<{ data: RegisterVerifyOtpResponse }>("/auth/register/verify-otp", dto);
  return unwrap(res);
}

/** Step 3 — complete registration with password; returns tokens (auto-login) */
export async function registerComplete(dto: RegisterCompleteDto): Promise<TokenResponse> {
  const res = await apiClient.post<{ data: TokenResponse }>("/auth/register/complete", dto);
  return unwrap(res);
}

// ─── Auth Password Flows ──────────────────────────────────────────────────────

/** Step 1 — request OTP email for password reset (no auth required) */
export async function forgotPassword(email: string): Promise<void> {
  await apiClient.post("/auth/forgot-password", { email } satisfies ForgotPasswordDto);
}

/** Step 2 — verify OTP and receive a short-lived reset token (no auth required) */
export async function verifyOtp(
  email: string,
  otp: string,
): Promise<VerifyOtpResponse> {
  const res = await apiClient.post<{ data: VerifyOtpResponse }>("/auth/verify-otp", {
    email,
    otp,
  } satisfies VerifyOtpDto);
  return unwrap(res);
}

/** Step 3 — set new password using the reset token (no auth required) */
export async function resetPassword(
  resetToken: string,
  newPassword: string,
): Promise<void> {
  await apiClient.post("/auth/reset-password", {
    resetToken,
    newPassword,
  } satisfies ResetPasswordDto);
}

/** Change password for currently authenticated user (auth required) */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiClient.post("/users/me/change-password", {
    currentPassword,
    newPassword,
  } satisfies ChangePasswordDto);
}

/** Logout current authenticated session (auth required) */
export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout");
}
