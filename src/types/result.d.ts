export type Ok<T> = {
  readonly success: true;
  readonly value: T;
};

export type Err<E> = {
  readonly success: false;
  readonly error: E;
};

export type Result<T, E = Error> = Ok<T> | Err<E>;

export declare function ok<T>(value: T): Ok<T>;
export declare function err<E>(error: E): Err<E>;
export declare function isOk<T, E>(result: Result<T, E>): result is Ok<T>;
export declare function isErr<T, E>(result: Result<T, E>): result is Err<E>;
export declare function map<T, U, E>(result: Result<T, E>, fn: (val: T) => U): Result<U, E>;
export declare function mapErr<T, E, F>(result: Result<T, E>, fn: (e: E) => F): Result<T, F>;
export declare function unwrap<T, E>(result: Result<T, E>): T;
export declare function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T;
