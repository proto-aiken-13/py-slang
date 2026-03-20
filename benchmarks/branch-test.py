def branch_test(a, b, c):
    if a > 0:
        if b < 0:
            if c > 0:
                return -3
            else:
                return -2
        else:
            if c > 0:
                return -1
            else:
                return 0
    else:
        if b < 0:
            if c > 0:
                return 1
            else:
                return 2
        else:
            if c > 0:
                return 3
            else:
                return 4

result = branch_test(1, -1, 1)+branch_test(1, -1, 0)+branch_test(1, 0, 1)+branch_test(1, 0, 0)+branch_test(0, -1, 1)+branch_test(0, -1, 0)+branch_test(0, 0, 1)+branch_test(0, 0, 0)
print(result)
