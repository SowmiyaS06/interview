"use client";

import { z } from "zod";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { auth, firebaseClientConfigError } from "@/firebase/client";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { FirebaseError } from "firebase/app";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";

import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

import { signIn, signUp } from "@/lib/actions/auth.action";
import FormField from "./FormField";

type AuthFormValues = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

const getAuthErrorMessage = (error: unknown) => {
  if (!(error instanceof FirebaseError)) return "Something went wrong. Please try again.";

  if (error.code === "auth/email-already-in-use") {
    return "This email is already in use. Please sign in instead.";
  }

  if (error.code === "auth/invalid-credential") {
    return "Invalid email or password.";
  }

  if (error.code === "auth/too-many-requests") {
    return "Too many attempts. Please wait and try again.";
  }

  return error.message || "Authentication failed. Please try again.";
};

const AuthForm = ({ type }: { type: FormType }) => {
  const router = useRouter();
  const isSignIn = type === "sign-in";

  const formSchema = z
    .object({
      name: z.string().trim(),
      email: z
        .string()
        .trim()
        .email("Enter a valid email address."),
      password: z.string(),
      confirmPassword: z.string(),
    })
    .superRefine((data, ctx) => {
      if (data.password.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Password is required.",
          path: ["password"],
        });
      }

      if (isSignIn) return;

      if (data.name.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Full name must be at least 2 characters.",
          path: ["name"],
        });
      }

      if (data.name.length > 50) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Full name must be 50 characters or less.",
          path: ["name"],
        });
      }

      if (!/^[A-Za-z\s'-]+$/.test(data.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Name can contain letters, spaces, apostrophes, and hyphens only.",
          path: ["name"],
        });
      }

      if (data.password.length < 8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Password must be at least 8 characters.",
          path: ["password"],
        });
      }

      if (data.password.length > 72) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Password must be 72 characters or less.",
          path: ["password"],
        });
      }

      if (!/[A-Z]/.test(data.password)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Password must include at least one uppercase letter.",
          path: ["password"],
        });
      }

      if (!/[a-z]/.test(data.password)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Password must include at least one lowercase letter.",
          path: ["password"],
        });
      }

      if (!/[0-9]/.test(data.password)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Password must include at least one number.",
          path: ["password"],
        });
      }

      if (!/[^A-Za-z0-9]/.test(data.password)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Password must include at least one special character.",
          path: ["password"],
        });
      }

      if (!data.confirmPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please confirm your password.",
          path: ["confirmPassword"],
        });
      }

      if (data.password !== data.confirmPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passwords do not match.",
          path: ["confirmPassword"],
        });
      }
    });

  const form = useForm<AuthFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: AuthFormValues) => {
    try {
      if (!auth) {
        toast.error(firebaseClientConfigError ?? "Firebase Auth is not configured correctly.");
        return;
      }

      if (type === "sign-up") {
        const { name, email, password } = data;

        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

        const result = await signUp({
          uid: userCredential.user.uid,
          name: name!,
          email,
          password,
        });

        if (!result.success) {
          toast.error(result.message);
          return;
        }

        toast.success("Account created successfully. Please sign in.");
        router.push("/sign-in");
      } else {
        const { email, password } = data;

        const userCredential = await signInWithEmailAndPassword(
          auth,
          email,
          password
        );

        const idToken = await userCredential.user.getIdToken();
        if (!idToken) {
          toast.error("Sign in Failed. Please try again.");
          return;
        }

        await signIn({
          email,
          idToken,
        });

        toast.success("Signed in successfully.");
        router.push("/");
      }
    } catch (error) {
      console.log(error);
      toast.error(getAuthErrorMessage(error));
    }
  };

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div className="card-border lg:min-w-141.5">
      <div className="flex flex-col gap-6 card py-14 px-10">
        <div className="flex flex-row gap-2 justify-center">
          <Image src="/logo.svg" alt="logo" height={32} width={38} />
          <h2 className="text-primary-100">PrepWise</h2>
        </div>

        <h3>{isSignIn ? "Welcome back" : "Create your account"}</h3>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="w-full space-y-6 mt-4 form"
          >
            {!isSignIn && (
              <FormField
                control={form.control}
                name="name"
                label="Full Name"
                placeholder="Enter your full name"
                type="text"
                autoComplete="name"
                disabled={isSubmitting}
              />
            )}

            <FormField
              control={form.control}
              name="email"
              label="Email"
              placeholder="Enter your email address"
              type="email"
              autoComplete="email"
              disabled={isSubmitting}
            />

            <FormField
              control={form.control}
              name="password"
              label="Password"
              placeholder={isSignIn ? "Enter your password" : "Create a strong password"}
              type="password"
              autoComplete={isSignIn ? "current-password" : "new-password"}
              disabled={isSubmitting}
            />

            {!isSignIn && (
              <FormField
                control={form.control}
                name="confirmPassword"
                label="Confirm Password"
                placeholder="Re-enter your password"
                type="password"
                autoComplete="new-password"
                disabled={isSubmitting}
              />
            )}

            <Button className="btn" type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? isSignIn
                  ? "Signing In..."
                  : "Creating Account..."
                : isSignIn
                  ? "Sign In"
                  : "Create Account"}
            </Button>
          </form>
        </Form>

        <p className="text-center">
          {isSignIn ? "No account yet?" : "Have an account already?"}
          <Link
            href={!isSignIn ? "/sign-in" : "/sign-up"}
            className="font-bold text-user-primary ml-1"
          >
            {!isSignIn ? "Sign In" : "Sign Up"}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default AuthForm;
