import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import {
  type FieldValues,
  FormProvider,
  type Resolver,
  type SubmitHandler,
  type UseFormProps,
  type UseFormReturn,
  useForm,
  useFormContext,
} from "react-hook-form";
import type { z } from "zod";
import { Input, type InputProps } from "./input";
import { Label } from "./label";

/** useForm pre-wired with a Zod schema - the same schema the API validates with. */
export function useZodForm<TOut extends FieldValues>(
  schema: z.ZodType<TOut>,
  options?: Omit<UseFormProps<TOut>, "resolver">,
): UseFormReturn<TOut> {
  return useForm<TOut>({
    resolver: zodResolver(schema as never) as Resolver<TOut>,
    ...options,
  });
}

export function Form<T extends FieldValues>({
  form,
  onSubmit,
  children,
  className,
}: {
  form: UseFormReturn<T>;
  onSubmit: SubmitHandler<T>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <FormProvider {...form}>
      <form className={className} onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {children}
      </form>
    </FormProvider>
  );
}

/** A labelled text input bound to the surrounding <Form> by `name`. */
export function TextField({ name, label, ...props }: InputProps & { name: string; label: string }) {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  const error = errors[name];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} aria-invalid={error ? true : undefined} {...register(name)} {...props} />
      {error ? <p className="text-xs text-destructive">{String(error.message)}</p> : null}
    </div>
  );
}
