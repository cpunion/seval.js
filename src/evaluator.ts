/**
 * S-Expression Evaluator
 *
 * Safe, sandboxed evaluation of S-expressions with customizable primitives.
 *
 * Design:
 * - Symbols (typeof === 'symbol') are variable references, looked up in env
 * - Strings (typeof === 'string') are string literals, returned as-is
 */

import { type SExpr, isSymbol, parse, sym, symName } from './parser'
import { defaultPrimitives } from './primitives'
import type {
    Environment,
    EvaluateFn,
    EvaluatorOptions,
    LambdaFunction,
    PrimitiveFunction,
    Value,
} from './types'
import { isLambda } from './types'

/**
 * Create a new evaluator instance with optional custom primitives
 */
export function createEvaluator(options: EvaluatorOptions = {}) {
    const primitives: Record<string, PrimitiveFunction> = {
        ...defaultPrimitives,
        ...options.primitives,
    }
    const maxDepth = options.maxDepth ?? 100

    function evaluate(expr: SExpr, env: Environment, depth = 0): Value {
        if (depth > maxDepth) {
            throw new Error('Maximum evaluation depth exceeded')
        }

        // Null
        if (expr === null) return null

        // Literal values
        if (typeof expr === 'number') return expr
        if (typeof expr === 'boolean') return expr

        // String literal - return as-is
        if (typeof expr === 'string') return expr

        // Symbol - look up in environment
        if (isSymbol(expr)) {
            const name = symName(expr)
            if (name in env) {
                return env[name] as Value
            }
            // Symbol not found - return the name as string (might be a primitive name)
            return name
        }

        // List (function application)
        if (Array.isArray(expr)) {
            if (expr.length === 0) return []

            const [op, ...args] = expr
            const opName = isSymbol(op) ? symName(op) : null

            // Special forms (check by symbol name)
            if (opName === 'if') {
                const [cond, thenExpr, elseExpr] = args
                const condResult = evaluate(cond as SExpr, env, depth + 1)
                return condResult
                    ? evaluate(thenExpr as SExpr, env, depth + 1)
                    : evaluate(elseExpr as SExpr, env, depth + 1)
            }

            if (opName === 'let') {
                // (let ((x 1) (y 2)) body)
                const [bindings, body] = args
                const newEnv = { ...env }
                for (const binding of bindings as SExpr[]) {
                    const [nameExpr, value] = binding as [SExpr, SExpr]
                    const name = isSymbol(nameExpr) ? symName(nameExpr) : String(nameExpr)
                    newEnv[name] = evaluate(value, newEnv, depth + 1)
                }
                return evaluate(body as SExpr, newEnv, depth + 1)
            }

            if (opName === 'cond') {
                // (cond (test1 expr1) (test2 expr2) (else exprN))
                for (const clause of args) {
                    const [test, result] = clause as [SExpr, SExpr]
                    const isElse = isSymbol(test) && symName(test) === 'else'
                    if (isElse || evaluate(test, env, depth + 1)) {
                        return evaluate(result, env, depth + 1)
                    }
                }
                return null
            }

            if (opName === 'begin' || opName === 'progn' || opName === 'do') {
                let result: Value = null
                for (const subExpr of args) {
                    result = evaluate(subExpr as SExpr, env, depth + 1)
                }
                return result
            }

            if (opName === 'quote') {
                const val = args[0]
                // For symbols, return the name as string
                if (isSymbol(val)) {
                    return symName(val)
                }
                return val as Value
            }

            // Lambda: (lambda (x y) (+ x y)) or (fn (x y) (+ x y))
            if (opName === 'lambda' || opName === 'fn') {
                const [params, body] = args
                return {
                    __lambda: true,
                    params: (params as SExpr[]).map((p) => (isSymbol(p) ? symName(p) : String(p))),
                    body: body as SExpr,
                    closure: env,
                } as LambdaFunction
            }

            // Define: (define name value) or (define (name args...) body)
            if (opName === 'define' || opName === 'defun') {
                const first = args[0]
                if (Array.isArray(first)) {
                    // (define (name args...) body) - function definition shorthand
                    const [nameExpr, ...paramExprs] = first as SExpr[]
                    const name = isSymbol(nameExpr) ? symName(nameExpr) : String(nameExpr)
                    const params = paramExprs.map((p) => (isSymbol(p) ? symName(p) : String(p)))
                    const body = args[1]
                    const fn: LambdaFunction = {
                        __lambda: true,
                        params,
                        body: body as SExpr,
                        closure: env,
                    }
                    env[name] = fn
                    return fn
                }
                // (define name value)
                const name = isSymbol(first) ? symName(first) : String(first)
                const value = evaluate(args[1] as SExpr, env, depth + 1)
                env[name] = value
                return value
            }

            // Apply: (apply fn list-of-args)
            if (opName === 'apply') {
                const fn = evaluate(args[0] as SExpr, env, depth + 1)
                const fnArgs = evaluate(args[1] as SExpr, env, depth + 1) as Value[]
                if (isLambda(fn)) {
                    const callEnv = { ...fn.closure }
                    fn.params.forEach((param, i) => {
                        callEnv[param] = fnArgs[i] as Value
                    })
                    return evaluate(fn.body, callEnv, depth + 1)
                }
                throw new Error(`Cannot apply non-function: ${fn}`)
            }

            // Higher-order functions with inline predicates or lambda
            if (opName === 'filter') {
                const [predExpr, listExpr] = args
                const pred = evaluate(predExpr as SExpr, env, depth + 1)
                const list = evaluate(listExpr as SExpr, env, depth + 1) as Value[]
                if (isLambda(pred)) {
                    return list.filter((item) => {
                        const callEnv = { ...pred.closure }
                        callEnv[pred.params[0] as string] = item
                        return evaluate(pred.body, callEnv, depth + 1)
                    })
                }
                // Inline expression form
                return list.filter((item) => {
                    const itemEnv = { ...env, '@': item, it: item }
                    return evaluate(predExpr as SExpr, itemEnv, depth + 1)
                })
            }

            if (opName === 'map') {
                const [mapExpr, listExpr] = args
                const mapper = evaluate(mapExpr as SExpr, env, depth + 1)
                const list = evaluate(listExpr as SExpr, env, depth + 1) as Value[]
                if (isLambda(mapper)) {
                    return list.map((item) => {
                        const callEnv = { ...mapper.closure }
                        callEnv[mapper.params[0] as string] = item
                        return evaluate(mapper.body, callEnv, depth + 1)
                    })
                }
                // Inline expression form
                return list.map((item) => {
                    const itemEnv = { ...env, '@': item, it: item }
                    return evaluate(mapExpr as SExpr, itemEnv, depth + 1)
                })
            }

            if (opName === 'find') {
                const [listExpr, predExpr] = args
                const list = evaluate(listExpr as SExpr, env, depth + 1) as Value[]
                return (
                    list.find((item) => {
                        const itemEnv = { ...env, '@': item, it: item }
                        return evaluate(predExpr as SExpr, itemEnv, depth + 1)
                    }) ?? null
                )
            }

            if (opName === 'find-index') {
                const [listExpr, predExpr] = args
                const list = evaluate(listExpr as SExpr, env, depth + 1) as Value[]
                return list.findIndex((item) => {
                    const itemEnv = { ...env, '@': item, it: item }
                    return evaluate(predExpr as SExpr, itemEnv, depth + 1)
                })
            }

            if (opName === 'sort-by') {
                const [listExpr, keyExpr] = args
                const list = evaluate(listExpr as SExpr, env, depth + 1) as Value[]
                return [...list].sort((a, b) => {
                    const aKey = evaluate(keyExpr as SExpr, { ...env, '@': a, it: a }, depth + 1)
                    const bKey = evaluate(keyExpr as SExpr, { ...env, '@': b, it: b }, depth + 1)
                    return (aKey as number) - (bKey as number)
                })
            }

            if (opName === 'count') {
                const [listExpr, predExpr] = args
                const list = evaluate(listExpr as SExpr, env, depth + 1) as Value[]
                if (!predExpr) return list.length
                return list.filter((item) => {
                    const itemEnv = { ...env, '@': item, it: item }
                    return evaluate(predExpr as SExpr, itemEnv, depth + 1)
                }).length
            }

            // Reduce: (reduce list init-value (acc item) body) or (reduce list init-value fn)
            if (opName === 'reduce' || opName === 'fold') {
                const [listExpr, initExpr, ...rest] = args
                const list = evaluate(listExpr as SExpr, env, depth + 1) as Value[]
                let acc = evaluate(initExpr as SExpr, env, depth + 1)

                if (rest.length === 2) {
                    // Inline form: (reduce list init (acc item) body)
                    const [params, body] = rest
                    const [accExpr, itemExpr] = params as [SExpr, SExpr]
                    const accName = isSymbol(accExpr) ? symName(accExpr) : String(accExpr)
                    const itemName = isSymbol(itemExpr) ? symName(itemExpr) : String(itemExpr)
                    for (const item of list) {
                        const reduceEnv = { ...env, [accName]: acc, [itemName]: item }
                        acc = evaluate(body as SExpr, reduceEnv, depth + 1)
                    }
                } else {
                    // Function form: (reduce list init fn)
                    const fn = evaluate(rest[0] as SExpr, env, depth + 1)
                    if (isLambda(fn)) {
                        for (const item of list) {
                            const callEnv = { ...fn.closure }
                            callEnv[fn.params[0] as string] = acc
                            callEnv[fn.params[1] as string] = item
                            acc = evaluate(fn.body, callEnv, depth + 1)
                        }
                    } else {
                        throw new Error('reduce requires a function')
                    }
                }
                return acc
            }

            // Regular function call or lambda invocation
            // First check if op is a symbol that resolves to a lambda
            const opValue = opName && opName in env ? (env[opName] as Value) : null

            if (isLambda(opValue)) {
                // Call user-defined function
                const evaluatedArgs = args.map((arg) => evaluate(arg as SExpr, env, depth + 1))
                const callEnv = { ...opValue.closure }
                opValue.params.forEach((param, i) => {
                    callEnv[param] = evaluatedArgs[i] as Value
                })
                return evaluate(opValue.body, callEnv, depth + 1)
            }

            // Check if it's a primitive function (by symbol name)
            if (opName) {
                const fn = primitives[opName]
                if (fn) {
                    const evaluatedArgs = args.map((arg) => evaluate(arg as SExpr, env, depth + 1))
                    const evalFn: EvaluateFn = (e, newEnv) => evaluate(e, newEnv, depth + 1)
                    return fn(evaluatedArgs, env, evalFn)
                }
            }

            // Maybe op itself is a lambda expression (not a symbol)
            const evaluatedOp = evaluate(op as SExpr, env, depth + 1)
            if (isLambda(evaluatedOp)) {
                const evaluatedArgs = args.map((arg) => evaluate(arg as SExpr, env, depth + 1))
                const callEnv = { ...evaluatedOp.closure }
                evaluatedOp.params.forEach((param, i) => {
                    callEnv[param] = evaluatedArgs[i] as Value
                })
                return evaluate(evaluatedOp.body, callEnv, depth + 1)
            }

            throw new Error(`Unknown function: ${opName ?? String(op)}`)
        }

        throw new Error(`Cannot evaluate: ${JSON.stringify(expr)}`)
    }

    return {
        evaluate: (expr: SExpr, env: Environment = {}) => evaluate(expr, env),
        evalString: (code: string, env: Environment = {}) => evaluate(parse(code), env),
    }
}

// Default evaluator instance
export const defaultEvaluator = createEvaluator()

/**
 * Evaluate an S-expression AST
 */
export const evaluate = defaultEvaluator.evaluate

/**
 * Parse and evaluate an S-expression string
 */
export const evalString = defaultEvaluator.evalString
