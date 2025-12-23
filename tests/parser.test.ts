/**
 * Parser Tests
 */

import { describe, expect, it } from 'bun:test'
import { parse, stringify } from '../src/parser'

describe('Parser', () => {
    it('parses numbers', () => {
        expect(parse('42')).toBe(42)
        expect(parse('-3.14')).toBe(-3.14)
    })

    it('parses booleans', () => {
        expect(parse('true')).toBe(true)
        expect(parse('false')).toBe(false)
        expect(parse('#t')).toBe(true)
        expect(parse('#f')).toBe(false)
    })

    it('parses symbols', () => {
        expect(parse('foo')).toBe('foo')
        expect(parse('+')).toBe('+')
        expect(parse('bar-baz')).toBe('bar-baz')
    })

    it('parses lists', () => {
        expect(parse('(+ 1 2)')).toEqual(['+', 1, 2])
        expect(parse('(a b c)')).toEqual(['a', 'b', 'c'])
    })

    it('parses nested lists', () => {
        expect(parse('(+ (* 2 3) 4)')).toEqual(['+', ['*', 2, 3], 4])
    })

    it('parses empty list', () => {
        expect(parse('()')).toEqual([])
    })

    it('handles whitespace', () => {
        expect(parse('  (  +  1  2  )  ')).toEqual(['+', 1, 2])
        expect(parse('(\n\t+\n\t1\n\t2\n)')).toEqual(['+', 1, 2])
    })

    it('skips comments', () => {
        expect(parse('; comment\n42')).toBe(42)
        expect(parse('(+ 1 ; inline comment\n2)')).toEqual(['+', 1, 2])
    })

    it('throws on unclosed paren', () => {
        expect(() => parse('(+ 1 2')).toThrow()
    })

    it('throws on unclosed string', () => {
        expect(() => parse('"hello')).toThrow()
    })

    it('throws on extra input', () => {
        expect(() => parse('1 2')).toThrow()
    })
})

describe('Stringify', () => {
    it('stringifies numbers', () => {
        expect(stringify(42)).toBe('42')
        expect(stringify(-3.14)).toBe('-3.14')
    })

    it('stringifies booleans', () => {
        expect(stringify(true)).toBe('true')
        expect(stringify(false)).toBe('false')
    })

    it('stringifies symbols', () => {
        expect(stringify('foo')).toBe('foo')
    })

    it('stringifies lists', () => {
        expect(stringify(['+', 1, 2])).toBe('(+ 1 2)')
    })

    it('stringifies nested lists', () => {
        expect(stringify(['+', ['*', 2, 3], 4])).toBe('(+ (* 2 3) 4)')
    })

    it('round-trips expressions', () => {
        const expr = '(let ((x 1) (y 2)) (+ x y))'
        expect(stringify(parse(expr))).toBe(expr)
    })
})
